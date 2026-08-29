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

  try {
    const { sendBookingConfirmation } = await import("@/lib/email");
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
    });
  } catch (err) {
    console.error("Confirmation email failed:", err.message);
    captureError(err, { tags: { route: "bookings.confirm", email: "booking-confirmation" }, extra: { bookingId: booking.id } });
  }

  return NextResponse.redirect(new URL(`/booking/success?booking_id=${booking.id}&type=email`, req.url));
}
