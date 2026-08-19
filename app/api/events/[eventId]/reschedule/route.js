import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// event_date is a plain date (no time-of-day), so "24 hours before the
// event" is measured from midnight on that date -- same convention as the
// cancellation/refund-eligibility check in the cancel route.
function hoursUntilEvent(eventDate) {
  return (new Date(`${eventDate}T00:00:00`).getTime() - Date.now()) / 3600000;
}

// Self-service rescheduling is only safe while nothing's happened yet --
// once the pipeline starts editing (or the event is delivered/cancelled),
// silently moving event_date out from under it would desync deadlines and
// confuse an already-in-progress or finished recap.
const RESCHEDULABLE_STATUSES = ["booked", "collecting"];

export async function GET(req, { params }) {
  const { eventId } = params;

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
    rescheduleEligible: RESCHEDULABLE_STATUSES.includes(booking.status) && hoursUntilEvent(booking.event_date) >= 24,
  });
}

export async function POST(req, { params }) {
  const { eventId } = params;
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

  if (hoursUntilEvent(booking.event_date) < 24) {
    return NextResponse.json(
      { error: "This is within 24 hours of your event, so it's too late to reschedule online — reply to your confirmation email and we'll help." },
      { status: 400 }
    );
  }

  if (hoursUntilEvent(newDate) < 24) {
    return NextResponse.json({ error: "Your new date needs to be at least 24 hours from now." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ event_date: newDate })
    .eq("id", booking.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to reschedule booking" }, { status: 500 });
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
  }

  return NextResponse.json({ success: true, newDate });
}
