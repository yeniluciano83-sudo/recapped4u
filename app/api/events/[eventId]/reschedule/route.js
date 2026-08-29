import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { hoursUntilEventDate } from "@/lib/eventDate";
import { captureError } from "@/lib/sentry";

// Self-service rescheduling is only safe while nothing's happened yet --
// once the pipeline starts editing (or the event is delivered/cancelled),
// silently moving event_date out from under it would desync deadlines and
// confuse an already-in-progress or finished recap.
const RESCHEDULABLE_STATUSES = ["booked", "collecting"];

export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("host_name, event_type, event_date, tier, status")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({
    booking,
    rescheduleEligible: RESCHEDULABLE_STATUSES.includes(booking.status) && hoursUntilEventDate(booking.event_date) >= 24,
  });
}

export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { newDate } = await req.json();

  if (!newDate || Number.isNaN(new Date(`${newDate}T00:00:00`).getTime())) {
    return NextResponse.json({ error: "Please pick a valid date." }, { status: 400 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
    return NextResponse.json(
      { error: "This event can't be rescheduled online anymore — reply to your confirmation email and we'll help." },
      { status: 400 }
    );
  }

  if (hoursUntilEventDate(booking.event_date) < 24) {
    return NextResponse.json(
      { error: "This is within 24 hours of your event, so it's too late to reschedule online — reply to your confirmation email and we'll help." },
      { status: 400 }
    );
  }

  if (hoursUntilEventDate(newDate) < 24) {
    return NextResponse.json({ error: "Your new date needs to be at least 24 hours from now." }, { status: 400 });
  }

  // Guarded on status still matching what we just read: the pipeline's
  // atomic claim (collecting -> analyzing, see poll-and-recap.js) could land
  // in the gap between the RESCHEDULABLE_STATUSES check above and this
  // update -- without this guard, that race lets event_date change on a
  // booking that's already mid-processing, desyncing its deadlines from
  // what the running pipeline already read into memory.
  const { data: rescheduledRow, error: updateError } = await supabase
    .from("bookings")
    .update({ event_date: newDate })
    .eq("id", booking.id)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: "Failed to reschedule booking" }, { status: 500 });
  }

  if (!rescheduledRow) {
    return NextResponse.json(
      { error: "This event just started processing and can't be rescheduled online anymore — reply to your confirmation email and we'll help." },
      { status: 409 }
    );
  }

  try {
    const { sendRescheduleConfirmation } = await import("@/lib/email");
    await sendRescheduleConfirmation({
      to: booking.email,
      hostName: booking.host_name,
      oldDate: booking.event_date,
      newDate,
    });
  } catch (err) {
    console.error("Reschedule confirmation email failed:", err.message);
    captureError(err, { tags: { route: "events.reschedule", email: "reschedule-confirmation" }, extra: { bookingId: booking.id } });
  }

  return NextResponse.json({ success: true, newDate });
}
