import Stripe from "stripe";
import { supabase } from "./supabase";
import { isAtLeast24HoursOut } from "./eventDate";
import { captureError } from "./sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// The actual cancel + refund + confirmation-email logic, shared between
// the host's own cancel link (app/api/events/[eventId]/cancel) and the
// staff dashboard's own cancel action (app/api/bookings/[id]/cancel) --
// same business rules regardless of who clicks: once processing has
// actually started, cancelling out from under it would let a
// refunded/cancelled booking still get delivered (same reasoning as
// RESCHEDULABLE_STATUSES in reschedule/route.js), and refund eligibility
// is the same 24-hour rule either way. Callers own their own auth (a host
// token vs. the dashboard's cookie, checked by proxy.js) and must look up
// `booking` (the full row, not just an id) before calling this.
export async function cancelBooking(booking) {
  if (booking.status === "cancelled") {
    return { body: { success: true, alreadyCancelled: true }, status: 200 };
  }

  // "analyzing" counts as started: its photos are already in a paid-for
  // Claude batch by the time a booking reaches it (see submitAnalysisBatch
  // in scripts/auto-recap.js).
  if (["analyzing", "editing", "awaiting_roast_approval", "delivered"].includes(booking.status)) {
    return {
      body: { error: "This event is already being processed and can't be cancelled online — message us on WhatsApp (+1 (646) 512-9151) and we'll help." },
      status: 400,
    };
  }

  // Claimed (and guarded on status still matching what was just read)
  // BEFORE any refund is issued below: the pipeline's atomic claim
  // (collecting -> editing, see poll-and-recap.js) could land in the gap
  // between the caller's own status check and this update. Locking in the
  // cancellation first means that race can only ever result in "refused to
  // cancel, no refund issued" -- never "refund issued, but the
  // cancellation lost the race and the booking still got processed and
  // delivered."
  const { data: cancelledRow, error: claimError } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", booking.id)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();

  if (claimError) {
    return { body: { error: "Failed to cancel booking" }, status: 500 };
  }

  if (!cancelledRow) {
    return {
      body: { error: "This event just started processing and can't be cancelled online anymore — message us on WhatsApp (+1 (646) 512-9151) and we'll help." },
      status: 409,
    };
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
    const { sendCancellationConfirmation } = await import("./email");
    await sendCancellationConfirmation({
      to: booking.email,
      hostName: booking.host_name,
      eventType: booking.event_type,
      eventDate: booking.event_date,
      tier: booking.tier,
      refunded,
      refundEligible,
      amountRefunded,
    });
  } catch (err) {
    console.error("Cancellation confirmation email failed:", err.message);
    captureError(err, { tags: { route: "cancelBooking", email: "cancellation-confirmation" }, extra: { bookingId: booking.id } });
  }

  return { body: { success: true, refunded, amountRefunded }, status: 200 };
}

// The statuses cancelBooking will actually refuse -- exported so a caller
// (the dashboard's own UI) can hide/disable the action up front instead of
// only finding out after a real request round-trip.
export const NOT_CANCELLABLE_STATUSES = ["analyzing", "editing", "awaiting_roast_approval", "delivered", "cancelled"];
