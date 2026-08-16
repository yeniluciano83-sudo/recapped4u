import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_PRICES = {
  free: { amount: 0, label: "Free Package" },
  standard: { amount: 3500, label: "Classic Package" },
  premium: { amount: 42500, label: "Signature Package" },
  keepsake: { amount: 55000, label: "Luxe Package" },
};

export async function POST(req) {
  try {
    const body = await req.json();
    const { hostName, email, eventType, eventDate, guestCount, tier, style, notes, roastEnabled, roastLevel } = body;

    if (!hostName || !email || !eventType || !eventDate || !tier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const uploadSlug = randomUUID().split("-")[0];

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        host_name: hostName,
        email,
        event_type: eventType,
        event_date: eventDate,
        guest_count: guestCount || null,
        tier,
        style: style || null,
        notes: notes || null,
        upload_slug: uploadSlug,
        status: "booked",
        roast_enabled: body.roastEnabled || false,
        roast_level: body.roastEnabled ? body.roastLevel : null,
      })
      .select()
      .single();

    if (error) throw error;

    const price = TIER_PRICES[tier];

    // Free tier has nothing to charge -- skip Stripe entirely rather than
    // create a $0 checkout session, and confirm right away instead of
    // waiting on a payment webhook that will never fire.
    if (price.amount === 0) {
      await supabase
        .from("bookings")
        .update({ status: "collecting", stripe_payment_status: "paid" })
        .eq("id", booking.id);

      // Dynamic import, not a top-level one: constructing the Resend client
      // throws synchronously when RESEND_API_KEY is unset, which would
      // otherwise break booking creation for every tier, not just free.
      try {
        const { sendBookingConfirmation } = await import("@/lib/email");
        await sendBookingConfirmation({
          to: email,
          hostName,
          eventDate,
          eventType,
          guestCount,
          tier,
          style,
          amountPaid: "$0.00",
          uploadUrl: `${process.env.APP_URL}/event/${uploadSlug}`,
          uploadSlug,
        });
      } catch (err) {
        console.error("Confirmation email failed:", err.message);
      }

      return NextResponse.json({ bookingId: booking.id });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Recapped For You — ${price.label}` },
            unit_amount: price.amount,
          },
          quantity: 1,
        },
      ],
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
