import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Deliberately unauthenticated -- same trust model as /qr/[slug] and
// /event/[eventId]: the unguessable id in the URL (only ever sent to the
// host by email) is what gates access, not a login.
export async function GET(req, { params }) {
  const { id } = params;

  const { data: inquiry, error } = await supabase
    .from("custom_inquiries")
    .select("host_name, event_type, event_date, guest_count, status, quoted_tier, quoted_price_cents, quote_message")
    .eq("id", id)
    .single();

  if (error || !inquiry) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  return NextResponse.json({ inquiry });
}

// Accepting turns the quote into a real booking + Stripe Checkout session,
// same shape as a standard /api/bookings booking so the rest of the
// pipeline (webhook, auto-recap, dashboard) doesn't need to know this
// booking started life as a custom quote.
export async function POST(req, { params }) {
  const { id } = params;

  try {
    const { data: inquiry, error } = await supabase
      .from("custom_inquiries")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !inquiry) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (inquiry.status !== "quoted") {
      return NextResponse.json(
        { error: inquiry.status === "accepted" ? "This quote has already been accepted." : "There's no active quote to accept yet." },
        { status: 400 }
      );
    }

    const uploadSlug = randomUUID().split("-")[0];

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        host_name: inquiry.host_name,
        email: inquiry.email,
        event_type: inquiry.event_type,
        event_date: inquiry.event_date,
        guest_count: inquiry.guest_count,
        tier: inquiry.quoted_tier,
        style: inquiry.style,
        notes: inquiry.notes,
        upload_slug: uploadSlug,
        status: "booked",
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Recapped For You — Custom Package (${inquiry.event_type})` },
            unit_amount: inquiry.quoted_price_cents,
          },
          quantity: 1,
        },
      ],
      customer_email: inquiry.email,
      success_url: `${process.env.APP_URL}/booking/success?booking_id=${booking.id}`,
      cancel_url: `${process.env.APP_URL}/custom-quote/${id}?canceled=1`,
      metadata: { booking_id: booking.id },
    });

    await supabase.from("bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);
    await supabase
      .from("custom_inquiries")
      .update({ status: "accepted", booking_id: booking.id, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("Custom quote acceptance failed:", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
