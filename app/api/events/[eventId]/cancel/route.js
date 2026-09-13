import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isAtLeast24HoursOut } from "@/lib/eventDate";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";
import { cancelBooking } from "@/lib/cancelBooking";

export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, tier, status, cancelled_at, stripe_payment_status")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // upload_slug alone proves nothing here -- it's on the QR poster every
  // guest scans. See lib/hostToken.js.
  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  return NextResponse.json({
    booking,
    refundEligible: isAtLeast24HoursOut(booking.event_date),
  });
}

export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Checked before anything mutates: the status flip below happens whether or
  // not a refund is owed, so an unauthenticated caller inside the 24-hour
  // window could still destroy the recap. See lib/hostToken.js.
  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  // The actual cancel + refund + confirmation-email logic is shared with
  // the staff dashboard's own cancel action -- see cancelBooking's own
  // comment in lib/cancelBooking.js.
  const { body, status } = await cancelBooking(booking);
  return NextResponse.json(body, { status });
}
