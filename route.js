import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { sendBookingConfirmation } from "@/lib/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe requires the raw request body to verify the webhook signature,
// so this route must NOT parse JSON before verification.
export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;

    if (bookingId) {
      const { data: booking, error } = await supabase
        .from("bookings")
        .update({ stripe_payment_status: "paid", status: "collecting" })
        .eq("id", bookingId)
        .select()
        .single();

      if (!error && booking) {
        const uploadUrl = `${process.env.APP_URL}/event/${booking.upload_slug}`;
        await sendBookingConfirmation({
          to: booking.email,
          hostName: booking.host_name,
          eventDate: booking.event_date,
          uploadUrl,
        }).catch((err) => console.error("Confirmation email failed:", err));
      }
    }
  }

  return NextResponse.json({ received: true });
}
