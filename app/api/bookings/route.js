import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { generateConfirmToken } from "@/lib/confirmToken";
import { TIER_PRICES, SOCIAL_CUT_ELIGIBLE_TIERS, isRoastLevelSelectable, roastAddonPriceCents, defaultGalleryTemplate } from "@/lib/pricing";
import { canProceedFromStyleStep } from "@/lib/bookingFormValidation";
import { captureError } from "@/lib/sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  try {
    const body = await req.json();
    const { email, eventType, eventDate, guestCount, tier, style, socialStyle, notes, roastEnabled, roastLevel, deliveryFormat, fullVideoNoMusic, venue, eventTime } = body;
    const hostName = (body.hostName || "").trim();

    // Both optional and purely descriptive -- back the shareable guest
    // invite (app/api/invite/[bookingId]/route.js), nothing in the
    // pipeline reads either. eventTime is validated rather than trusted
    // as-is: it only ever needs to render on the invite image and the
    // confirmation email, and a garbage value there is a worse failure
    // (a visibly wrong time on something a host hands to their guests)
    // than just omitting it.
    const trimmedVenue = (venue || "").trim().slice(0, 200) || null;
    const validEventTime = typeof eventTime === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(eventTime) ? eventTime : null;

    // A whitespace-only hostName passes a plain truthy check, then breaks
    // hostName.split(" ")[0] personalization in every email template
    // ("Hi ,"). Trim before validating so it's rejected here instead.
    if (!hostName || !email || !eventType || !eventDate || !tier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Without this, an unrecognized tier sailed straight through to the
    // insert below, then crashed on `price.amount` (TIER_PRICES[tier] is
    // undefined) -- caught by the outer try/catch as a generic 500, but
    // only after an orphaned booking row with a garbage tier was already
    // sitting in the database with no way to clean it up. Checked before
    // the insert, unlike that crash was. app/api/admin/custom-quote/route.js
    // already validates its own tier list this way -- this is the same
    // check for the tier list that route doesn't cover (it excludes Free,
    // which has nothing to quote).
    if (!Object.prototype.hasOwnProperty.call(TIER_PRICES, tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const VALID_DELIVERY_FORMATS = ["recap", "video_only", "social_cuts"];
    // Only Spotlight/Luxe ever choose this -- every other tier only ever
    // gets a full video, so the UI never shows the picker and there's
    // nothing to require. This is the actual source of truth (the booking
    // form's own Continue button is just a UX nicety on top of it).
    if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier) && !VALID_DELIVERY_FORMATS.includes(deliveryFormat)) {
      return NextResponse.json({ error: "Please choose a delivery format." }, { status: 400 });
    }

    // Same reasoning as the delivery-format check above -- the booking
    // form's own Continue button (see lib/bookingFormValidation.js, which
    // this reuses directly rather than a second copy of the same rule) is a
    // UX nicety on top of this, not the actual gate. Without this, a
    // request that skips the form entirely stored style: null and the
    // pipeline silently defaulted to "cinematic" (enhancePhoto's own
    // default) -- not a crash, just a video in a style the host never
    // chose, with nothing anywhere to surface that it happened.
    const isSocialCutEligible = SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier);
    const isSocialCutsFormat = isSocialCutEligible && deliveryFormat === "social_cuts";
    if (!canProceedFromStyleStep({ isSocialCutEligible, deliveryFormat, isSocialCutsFormat, style, socialStyle })) {
      return NextResponse.json({ error: "Please choose a theme for your recap." }, { status: 400 });
    }

    // The full UUID, not a truncated prefix -- this slug is the only thing
    // gating every guest-facing event-management route (upload, close
    // uploads, extend deadline, cancel, reschedule, social style). An
    // 8-hex-char prefix is only 32 bits, brute-forceable; the full UUID is
    // 122 bits.
    const uploadSlug = randomUUID();

    const effectiveDeliveryFormat = SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier) ? deliveryFormat : "recap";
    // Roast Reel only ever captions the full video -- social cuts are
    // caption-free in every delivery format (see scripts/auto-recap.js's
    // renderOneSocialCut), so "social cuts of every photo" bookings have
    // no full video to caption at all. roast_enabled still gets recorded
    // there (harmless, matches nothing), but the intensity picker is
    // clamped below since it's the only part of this that can charge money.
    const effectiveRoastEnabled = !!roastEnabled;
    // Free/Highlight (and social-cuts-only, any tier) only ever get Light --
    // clamp server-side rather than trust whatever level the client sent
    // (the UI already restricts this, but this is the actual source of
    // truth for what gets charged below).
    const effectiveRoastLevel = effectiveRoastEnabled
      ? (isRoastLevelSelectable(tier, effectiveDeliveryFormat) ? (roastLevel || "light") : "light")
      : null;

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        host_name: hostName,
        email: (email || "").trim(),
        event_type: eventType,
        event_date: eventDate,
        venue: trimmedVenue,
        event_time: validEventTime,
        // "" (the form's empty-input default) must become null, but a
        // legitimately-entered 0 must not -- a plain `guestCount || null`
        // would coerce that 0 to null too.
        guest_count: guestCount === "" || guestCount == null ? null : guestCount,
        tier,
        style: style || null,
        social_style: SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier) ? socialStyle || null : null,
        notes: notes || null,
        upload_slug: uploadSlug,
        status: "booked",
        roast_enabled: effectiveRoastEnabled,
        roast_level: effectiveRoastLevel,
        delivery_format: effectiveDeliveryFormat,
        full_video_no_music: !!fullVideoNoMusic,
        gallery_template: defaultGalleryTemplate(),
      })
      .select()
      .single();

    if (error) throw error;

    const price = TIER_PRICES[tier];

    // Free tier has nothing to charge and no Stripe payment webhook to wait
    // on, but skipping straight to "collecting" would let anyone book a free
    // event under a stranger's email and have it go live immediately -- the
    // guest upload link would be active and confirmation/reminder emails
    // would go out to someone who never asked for any of it. Instead, hold
    // it at "pending_confirmation" (no upload link, no QR) until whoever
    // owns the email clicks the confirm link. Paid tiers don't need this:
    // Stripe payment is already a real-money barrier before anything's live.
    if (price.amount === 0) {
      const { error: pendingError } = await supabase
        .from("bookings")
        .update({ status: "pending_confirmation" })
        .eq("id", booking.id);
      if (pendingError) console.error("Failed to set booking to pending_confirmation:", pendingError.message);

      // Dynamic import, not a top-level one: constructing the Resend client
      // throws synchronously when RESEND_API_KEY is unset, which would
      // otherwise break booking creation for every tier, not just free.
      try {
        const { sendConfirmBookingEmail } = await import("@/lib/email");
        const token = generateConfirmToken(booking.id);
        await sendConfirmBookingEmail({
          to: email,
          hostName,
          eventDate,
          eventType,
          confirmUrl: `${process.env.APP_URL}/api/bookings/${booking.id}/confirm?token=${token}`,
        });
      } catch (err) {
        console.error("Confirmation email failed:", err.message);
        captureError(err, { tags: { route: "bookings.create", email: "confirm" }, extra: { bookingId: booking.id } });
      }

      return NextResponse.json({ bookingId: booking.id });
    }

    const lineItems = [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Recapped For You — ${price.label}` },
          unit_amount: price.amount,
        },
        quantity: 1,
      },
    ];

    const roastAddonAmount = effectiveRoastEnabled ? roastAddonPriceCents(tier, effectiveRoastLevel) : undefined;
    if (roastAddonAmount) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Roast Reel add-on" },
          unit_amount: roastAddonAmount,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Explicit card-only (default would auto-include Link if enabled on
      // the Stripe account) -- Link's whole pitch is 1-click checkout on
      // a FUTURE purchase, but every booking here is a one-off event with
      // no accounts/repeat-checkout flow, so its "save my info" prompt
      // has nothing to speed up for this product and just adds a
      // pointless extra step.
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: email,
      success_url: `${process.env.APP_URL}/booking/success?booking_id=${booking.id}`,
      cancel_url: `${process.env.APP_URL}/booking?canceled=1`,
      metadata: { booking_id: booking.id },
    });

    await supabase.from("bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);

    return NextResponse.json({ bookingId: booking.id, checkoutUrl: session.url });
  } catch (err) {
    console.error("Booking creation failed:", err);
    captureError(err, { tags: { route: "bookings.create" } });
    return NextResponse.json({ error: "Booking failed" }, { status: 500 });
  }
}

export async function GET() {
  const { data, error } = await supabase.from("bookings").select("*").order("event_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bookings: data });
}
