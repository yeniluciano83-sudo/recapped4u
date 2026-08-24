import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { generateConfirmToken } from "@/lib/confirmToken";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_PRICES = {
  free: { amount: 0, label: "Free Package" },
  standard: { amount: 3500, label: "Classic Package" },
  premium: { amount: 7500, label: "Signature Package" },
  keepsake: { amount: 9500, label: "Luxe Package" },
};

// Every tier gets Roast Reel now, and Light is complimentary on all of
// them. Signature is the only tier that ever charges for it -- stepping
// up to Lukewarm/Hot there is +$20. Luxe is complimentary at every
// intensity. Kept in sync with roastAddonPrice in app/booking/page.jsx
// (dollars there, cents here for Stripe).
const ROAST_FULL_LEVELS_TIERS = ["premium", "keepsake"];
function roastAddonPriceCents(tier, level) {
  if (tier === "premium") return level === "light" ? 0 : 2000;
  return 0;
}

const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];

export async function POST(req) {
  try {
    const body = await req.json();
    const { email, eventType, eventDate, guestCount, tier, style, socialStyle, notes, roastEnabled, roastLevel, deliveryFormat, fullVideoNoMusic } = body;
    const hostName = (body.hostName || "").trim();

    // A whitespace-only hostName passes a plain truthy check, then breaks
    // hostName.split(" ")[0] personalization in every email template
    // ("Hi ,"). Trim before validating so it's rejected here instead.
    if (!hostName || !email || !eventType || !eventDate || !tier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The full UUID, not a truncated prefix -- this slug is the only thing
    // gating every guest-facing event-management route (upload, close
    // uploads, extend deadline, cancel, reschedule, social style). An
    // 8-hex-char prefix is only 32 bits, brute-forceable; the full UUID is
    // 122 bits.
    const uploadSlug = randomUUID();

    const effectiveDeliveryFormat = SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier) && deliveryFormat === "social_cuts" ? "social_cuts" : "recap";
    // Roast Reel works on "social cuts of every photo" bookings too --
    // scripts/auto-recap.js generates a separate roast script per social
    // cut in that mode, since there's no full video there to caption.
    const effectiveRoastEnabled = !!roastEnabled;
    // Free/Classic only ever get Light -- clamp server-side rather than
    // trust whatever level the client sent (the UI already restricts this,
    // but this is the actual source of truth for what gets charged below).
    const effectiveRoastLevel = effectiveRoastEnabled
      ? (ROAST_FULL_LEVELS_TIERS.includes(tier) ? (roastLevel || "light") : "light")
      : null;

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        host_name: hostName,
        email: (email || "").trim(),
        event_type: eventType,
        event_date: eventDate,
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
    return NextResponse.json({ error: "Booking failed" }, { status: 500 });
  }
}

export async function GET() {
  const { data, error } = await supabase.from("bookings").select("*").order("event_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bookings: data });
}
