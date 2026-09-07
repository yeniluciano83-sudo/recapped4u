import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { SOCIAL_CUT_ELIGIBLE_TIERS, ROAST_FULL_LEVELS_TIERS, roastAddonPriceCents, defaultGalleryTemplate } from "@/lib/pricing";
import { captureError } from "@/lib/sentry";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Free has nothing to quote (it's already $0), so it's excluded here even
// though it's a valid `bookings.tier` value elsewhere.
const VALID_TIERS = ["standard", "premium", "keepsake"];

// Staff-only: creates a booking + Stripe Checkout link at a custom price for
// a host who negotiated outside the standard tiers (corporate events, etc).
// Auth is handled entirely by proxy.js's dashboard_auth cookie check
// (see the /api/admin/:path* matcher) -- this route trusts that gate rather
// than re-checking anything itself.
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      email, eventType, eventDate, eventEndDate, guestCount, tier, style, socialStyle,
      notes, roastEnabled, roastLevel, deliveryFormat, fullVideoNoMusic,
      amount, label, description,
    } = body;
    const hostName = (body.hostName || "").trim();
    const amountCents = Math.round(Number(amount) * 100);

    if (!hostName || !email || !eventType || !eventDate || !VALID_TIERS.includes(tier) || !Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    // Multi-day events only -- must be on/after the start date if provided.
    if (eventEndDate && eventEndDate < eventDate) {
      return NextResponse.json({ error: "End date can't be before the event date" }, { status: 400 });
    }

    const uploadSlug = randomUUID();
    const effectiveDeliveryFormat = SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier) && deliveryFormat === "social_cuts" ? "social_cuts" : "recap";
    const effectiveRoastEnabled = !!roastEnabled;
    const effectiveRoastLevel = effectiveRoastEnabled
      ? (ROAST_FULL_LEVELS_TIERS.includes(tier) ? (roastLevel || "light") : "light")
      : null;

    const bookingFields = {
      host_name: hostName,
      email: (email || "").trim(),
      event_type: eventType,
      event_date: eventDate,
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
      gallery_template: defaultGalleryTemplate(effectiveDeliveryFormat),
      custom_price_cents: amountCents,
    };

    let { data: booking, error } = await supabase
      .from("bookings")
      .insert(eventEndDate ? { ...bookingFields, event_end_date: eventEndDate } : bookingFields)
      .select()
      .single();

    // PGRST204 here means migration 023 (event_end_date) hasn't been applied
    // yet -- retry without it so quote creation still works; multi-day just
    // doesn't get recorded until the migration runs.
    if (error && error.code === "PGRST204" && eventEndDate) {
      console.error("bookings.event_end_date column missing (migration 023 not yet applied) -- creating quote without an end date");
      ({ data: booking, error } = await supabase.from("bookings").insert(bookingFields).select().single());
    }

    if (error) throw error;

    const lineItems = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: label?.trim() ? label.trim() : "Recapped For You — Custom Quote",
            ...(description?.trim() ? { description: description.trim() } : {}),
          },
          unit_amount: amountCents,
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
    console.error("Custom quote creation failed:", err);
    captureError(err, { tags: { route: "admin.custom-quote" } });
    return NextResponse.json({ error: "Failed to create custom quote" }, { status: 500 });
  }
}
