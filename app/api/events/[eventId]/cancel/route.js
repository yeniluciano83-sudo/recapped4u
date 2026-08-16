import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// event_date is a plain date (no time-of-day), so "24 hours before the
// event" is measured from midnight on that date.
function isRefundEligible(eventDate) {
  const hoursUntilEvent = (new Date(`${eventDate}T00:00:00`).getTime() - Date.now()) / 3600000;
  return hoursUntilEvent >= 24;
}

export async function GET(req, { params }) {
  const { eventId } = params;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("host_name, event_type, event_date, tier, status, cancelled_at")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({
    booking,
    refundEligible: isRefundEligible(booking.event_date),
  });
}

export async function POST(req, { params }) {
  const { eventId } = params;

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

  if (booking.status === "delivered") {
    return NextResponse.json(
      { error: "This event has already been delivered and can't be cancelled online — reply to your confirmation email and we'll help." },
      { status: 400 }
    );
  }

  const refundEligible = isRefundEligible(booking.event_date);
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
    }
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      ...(refunded ? { stripe_payment_status: "refunded" } : {}),
    })
    .eq("id", booking.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
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
  }

  return NextResponse.json({ success: true, refunded, amountRefunded });
}
