import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";
import { TIER_PRICES, nextUpgradeTier } from "@/lib/pricing";
import { captureError } from "@/lib/sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Clicked straight from the "you're full" email (lib/email.js's
// sendUploadCapReachedEmail) -- a GET, like the booking-confirmation link in
// app/api/bookings/[id]/confirm/route.js, since an email link is always a
// plain browser navigation, never a fetch() call the site's own JS could
// read a JSON response from. The target tier is never taken from the
// client: this route decides it itself via nextUpgradeTier(booking.tier),
// the same one the email advertised, so there's nothing here for a
// tampered query string to redirect to a cheaper tier than what gets
// charged -- the actual charge is computed server-side either way.
//
// Once a valid host token is confirmed, every remaining failure redirects
// back to the host's own QR page with an error toast (app/qr/[slug]/page.jsx
// already watches for this) rather than a bare JSON blob a human would
// otherwise see directly in their browser after clicking an email link.
export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, tier, status, upload_slug, email")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const hostToken = hostTokenFromRequest(req);
  if (!isValidHostToken(booking.id, hostToken)) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  const backToQr = (params) => NextResponse.redirect(new URL(`/qr/${booking.upload_slug}?t=${hostToken}&${params}`, req.url));

  if (booking.status !== "collecting") {
    return backToQr(`upgrade_error=${encodeURIComponent("This event isn't currently collecting uploads, so there's nothing to upgrade.")}`);
  }

  const newTier = nextUpgradeTier(booking.tier);
  if (!newTier) {
    return backToQr(`upgrade_error=${encodeURIComponent("You're already on the tier with the highest upload limit — there's nothing to upgrade to.")}`);
  }

  const priceDiffCents = TIER_PRICES[newTier].amount - TIER_PRICES[booking.tier].amount;
  if (priceDiffCents <= 0) {
    // Should be unreachable -- nextUpgradeTier only ever returns a tier with
    // a strictly higher cap, and every tier with a higher cap also costs
    // more (lib/pricing.js). Guarded anyway: this charges real money, and a
    // $0 or negative Stripe line item is a bug worth surfacing loudly
    // rather than silently creating a free "upgrade".
    captureError(new Error(`Non-positive upgrade price diff: ${booking.tier} -> ${newTier}`), {
      tags: { route: "events.upgrade" },
      extra: { bookingId: booking.id, fromTier: booking.tier, toTier: newTier },
    });
    return backToQr(`upgrade_error=${encodeURIComponent("Something went wrong pricing that upgrade — message us on WhatsApp and we'll sort it out.")}`);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Upgrade to ${TIER_PRICES[newTier].label}` },
            unit_amount: priceDiffCents,
          },
          quantity: 1,
        },
      ],
      customer_email: booking.email,
      success_url: `${process.env.APP_URL}/qr/${booking.upload_slug}?t=${hostToken}&upgraded=1`,
      cancel_url: `${process.env.APP_URL}/qr/${booking.upload_slug}?t=${hostToken}`,
      // upgrade_to_tier's mere presence is what tells the webhook this is an
      // upgrade payment, not an original booking payment -- see
      // app/api/webhooks/stripe/route.js.
      metadata: { booking_id: booking.id, upgrade_to_tier: newTier },
    });

    return NextResponse.redirect(session.url);
  } catch (err) {
    console.error(`Failed to create upgrade checkout session for booking ${booking.id}:`, err.message);
    captureError(err, { tags: { route: "events.upgrade" }, extra: { bookingId: booking.id } });
    return backToQr(`upgrade_error=${encodeURIComponent("Couldn't start the upgrade checkout. Please try again or message us on WhatsApp.")}`);
  }
}
