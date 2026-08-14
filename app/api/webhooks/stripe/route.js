import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { sendBookingConfirmation } from "@/lib/email";

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
      const { data: booking, error } = await supabase
        .from("bookings")
        .update({ stripe_payment_status: "paid", status: "collecting" })
        .eq("id", bookingId)
        .select()
        .single();

      console.log("Webhook update result — error:", error, "booking:", booking);
      if (!error && booking) {
        console.log("Attempting to send email to:", booking.email);
        const uploadUrl = `${process.env.APP_URL}/event/${booking.upload_slug}`;
        const emailResult = await sendBookingConfirmation({
          to: booking.email,
          hostName: booking.host_name,
          eventDate: booking.event_date,
          uploadUrl,
          uploadSlug: booking.upload_slug,
        }).catch((err) => {
          console.error("Confirmation email failed:", err);
          return null;
        });
        console.log("Email send result:", emailResult);
      } else {
        console.log("Skipped email — condition failed. error:", error, "booking exists:", !!booking);
      }
    }
  }

  return NextResponse.json({ received: true });
}
