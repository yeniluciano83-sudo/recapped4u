import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { sendBookingConfirmation } from "@/lib/email";
import { captureError } from "@/lib/sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;

    if (bookingId) {
      // Stripe retries this webhook (up to ~3 days) on any non-2xx response
      // or timeout, and a redelivery must be a no-op. Scoping the update to
      // .eq("status", "booked") makes it match zero rows -- and .single()
      // error out -- once a prior delivery already advanced this booking,
      // so a retry can't resend the confirmation email or regress a
      // further-along booking (editing/delivered) back to "collecting".
      const { data: booking, error } = await supabase
        .from("bookings")
        .update({ stripe_payment_status: "paid", status: "collecting" })
        .eq("id", bookingId)
        .eq("status", "booked")
        .select()
        .single();

      if (!error && booking) {
        const uploadUrl = `${process.env.APP_URL}/event/${booking.upload_slug}`;
        // Read the actual charged amount off the Stripe session rather than
        // re-deriving it from the tier's list price, so the email always
        // reflects what was really paid (discounts, currency, etc.).
        const amountPaid = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: (session.currency || "usd").toUpperCase(),
        }).format((session.amount_total || 0) / 100);
        try {
          await sendBookingConfirmation({
            to: booking.email,
            hostName: booking.host_name,
            eventDate: booking.event_date,
            eventType: booking.event_type,
            guestCount: booking.guest_count,
            tier: booking.tier,
            style: booking.style,
            amountPaid,
            roastEnabled: booking.roast_enabled,
            uploadUrl,
            uploadSlug: booking.upload_slug,
            bookingId: booking.id,
            deliveryFormat: booking.delivery_format,
          });
        } catch (err) {
          console.error(`Confirmation email failed for booking ${bookingId}:`, err.message);
          captureError(err, { tags: { route: "webhooks.stripe", email: "booking-confirmation" }, extra: { bookingId } });
        }
      } else if (error) {
        // Expected on a Stripe retry of an already-processed event -- the
        // .eq("status", "booked") guard above makes those match zero rows,
        // which .single() reports as an error. Not worth alerting on.
        console.log(`Webhook for booking ${bookingId}: no matching "booked" row (already processed, or booking missing).`);
      }
    }
  }

  return NextResponse.json({ received: true });
}
