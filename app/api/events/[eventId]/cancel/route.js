import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isAtLeast24HoursOut } from "@/lib/eventDate";
import { captureError } from "@/lib/sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("host_name, event_type, event_date, tier, status, cancelled_at, stripe_payment_status")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({
    booking,
    refundEligible: isAtLeast24HoursOut(booking.event_date),
  });
}

export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (booking.status === "cancelled") {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }

  // Once the recap pipeline has started (or finished), silently cancelling
  // out from under it would let a refunded/cancelled booking still get
  // delivered -- same reasoning as RESCHEDULABLE_STATUSES in
  // reschedule/route.js. "analyzing" counts as started: its photos are
  // already in a paid-for Claude batch by the time a booking reaches it
  // (see submitAnalysisBatch in scripts/auto-recap.js).
  if (["analyzing", "editing", "awaiting_roast_approval", "delivered"].includes(booking.status)) {
    return NextResponse.json(
      { error: "This event is already being processed and can't be cancelled online — reply to your confirmation email and we'll help." },
      { status: 400 }
    );
  }

  // Claimed (and guarded on status still matching what we just read) BEFORE
  // any refund is issued below: the pipeline's atomic claim (collecting ->
  // editing, see poll-and-recap.js) could land in the gap between the
  // status check above and this update. Locking in the cancellation first
  // means that race can only ever result in "refused to cancel, no refund
  // issued" -- never "refund issued, but the cancellation lost the race and
  // the booking still got processed and delivered."
  const { data: cancelledRow, error: claimError } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }

  if (!cancelledRow) {
    return NextResponse.json(
      { error: "This event just started processing and can't be cancelled online anymore — reply to your confirmation email and we'll help." },
      { status: 409 }
    );
  }

  const refundEligible = isAtLeast24HoursOut(booking.event_date);
  const isPaid = booking.tier !== "free" && booking.stripe_payment_status === "paid";

  let refunded = false;
  let amountRefunded = null;

  if (isPaid && refundEligible && booking.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
    if (session.payment_intent) {
      const refund = await stripe.refunds.create({ payment_intent: session.payment_intent });
      refunded = true;
      amountRefunded = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (refund.currency || "usd").toUpperCase(),
      }).format((refund.amount || 0) / 100);
      await supabase.from("bookings").update({ stripe_payment_status: "refunded" }).eq("id", booking.id);
    }
  }

  try {
    const { sendCancellationConfirmation } = await import("@/lib/email");
    await sendCancellationConfirmation({
      to: booking.email,
      hostName: booking.host_name,
      eventDate: booking.event_date,
      refunded,
      amountRefunded,
    });
  } catch (err) {
    console.error("Cancellation confirmation email failed:", err.message);
    captureError(err, { tags: { route: "events.cancel", email: "cancellation-confirmation" }, extra: { bookingId: booking.id } });
  }

  return NextResponse.json({ success: true, refunded, amountRefunded });
}
