import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isValidConfirmToken } from "@/lib/confirmToken";
import { captureError } from "@/lib/sentry";

// Clicked from the "Confirm your free recap" email -- activates a
// free-tier booking that was held at "pending_confirmation" so the guest
// upload link and QR code only go live once whoever owns the email address
// actually confirms it. See lib/confirmToken.js for why there's no stored
// token to look up.
export async function GET(req, { params }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token");

  if (!isValidConfirmToken(id, token)) {
    return NextResponse.redirect(new URL("/booking?confirm_error=1", req.url));
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !booking) {
    return NextResponse.redirect(new URL("/booking?confirm_error=1", req.url));
  }

  // Already confirmed (e.g. the link was clicked twice) -- don't re-send
  // the booking confirmation email, just send them to the success page.
  if (booking.status !== "pending_confirmation") {
    return NextResponse.redirect(new URL(`/booking/success?booking_id=${booking.id}&type=email`, req.url));
  }

  await supabase.from("bookings").update({ status: "collecting" }).eq("id", id);

  const { sendBookingConfirmation, sendNewBookingAlert } = await import("@/lib/email");

  try {
    await sendBookingConfirmation({
      to: booking.email,
      hostName: booking.host_name,
      eventDate: booking.event_date,
      eventType: booking.event_type,
      guestCount: booking.guest_count,
      tier: booking.tier,
      style: booking.style,
      amountPaid: "$0.00",
      roastEnabled: booking.roast_enabled,
      uploadUrl: `${process.env.APP_URL}/event/${booking.upload_slug}`,
      uploadSlug: booking.upload_slug,
      bookingId: booking.id,
      deliveryFormat: booking.delivery_format,
    });
  } catch (err) {
    console.error("Confirmation email failed:", err.message);
    captureError(err, { tags: { route: "bookings.confirm", email: "booking-confirmation" }, extra: { bookingId: booking.id } });
  }

  // Independent of the host's own confirmation above -- see the same
  // BOOKING_ALERT_EMAIL gate in app/api/webhooks/stripe/route.js, which
  // covers every paid tier; this covers the free tier's own activation path.
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
        amountPaid: "$0.00",
        bookingId: booking.id,
      });
    } catch (err) {
      console.error("New-booking alert failed:", err.message);
      captureError(err, { tags: { route: "bookings.confirm", email: "new-booking-alert" }, extra: { bookingId: booking.id } });
    }
  }

  return NextResponse.redirect(new URL(`/booking/success?booking_id=${booking.id}&type=email`, req.url));
}
