import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { sendBookingConfirmation, sendUpgradeConfirmation, sendNewBookingAlert } from "@/lib/email";
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
    const upgradeToTier = session.metadata?.upgrade_to_tier;

    // upgrade_to_tier's mere presence (set only by
    // app/api/events/[eventId]/upgrade/route.js) distinguishes an upgrade
    // payment from an original booking payment -- both are the same Stripe
    // event type, completed on the same webhook.
    if (bookingId && upgradeToTier) {
      // Same idempotency shape as the booking-payment branch below: scoped
      // to .eq("status", "collecting") (an upgrade only ever makes sense
      // while still collecting -- see the route) and .neq("tier",
      // upgradeToTier) so a Stripe retry of an already-applied upgrade
      // matches zero rows instead of re-sending the confirmation email.
      // upload_cap_notified_at reset for the same reason a photo delete
      // resets it (see the DELETE handler on
      // app/api/events/[eventId]/uploads/[uploadId]/route.js): a fresh,
      // higher cap deserves its own notification if it's ever reached too.
      const { data: booking, error } = await supabase
        .from("bookings")
        .update({ tier: upgradeToTier, upload_cap_notified_at: null })
        .eq("id", bookingId)
        .eq("status", "collecting")
        .neq("tier", upgradeToTier)
        .select()
        .single();

      if (!error && booking) {
        try {
          await sendUpgradeConfirmation({ to: booking.email, hostName: booking.host_name, newTier: upgradeToTier });
        } catch (err) {
          console.error(`Upgrade confirmation email failed for booking ${bookingId}:`, err.message);
          captureError(err, { tags: { route: "webhooks.stripe", email: "upgrade-confirmation" }, extra: { bookingId } });
        }
      } else if (error) {
        // Unlike the booking-payment branch below, this isn't necessarily
        // just a harmless retry of an already-applied upgrade -- the
        // booking's status could have moved on (uploads closed, processing
        // started) in the window between the host starting checkout and
        // completing it, in which case a real charge just landed with
        // nothing to show for it. Worth a real alert, not a console.log.
        console.error(`Webhook for upgrade on booking ${bookingId}: no matching "collecting" row at a different tier -- payment may need manual reconciliation.`);
        captureError(new Error("Upgrade webhook found no matching row to update"), {
          tags: { route: "webhooks.stripe", event: "upgrade" },
          extra: { bookingId, upgradeToTier },
        });
      }
    } else if (bookingId) {
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
        // Independent of the host's own confirmation above -- a staff alert
        // failing (or being unconfigured) should never affect, or be
        // affected by, whether the host got theirs.
        if (process.env.BOOKING_ALERT_EMAIL) {
          try {
            await sendNewBookingAlert({
              to: process.env.BOOKING_ALERT_EMAIL,
              hostName: booking.host_name,
              email: booking.email,
              eventType: booking.event_type,
              eventDate: booking.event_date,
              tier: booking.tier,
              guestCount: booking.guest_count,
              amountPaid,
              bookingId: booking.id,
            });
          } catch (err) {
            console.error(`New-booking alert failed for booking ${bookingId}:`, err.message);
            captureError(err, { tags: { route: "webhooks.stripe", email: "new-booking-alert" }, extra: { bookingId } });
          }
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
