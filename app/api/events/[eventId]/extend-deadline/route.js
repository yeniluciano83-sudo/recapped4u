import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const EXTENSION_HOURS = 48;

// Luxe-only perk: lets a host push their upload deadline out by a fixed
// 48 hours, once, if guests need more time. Like close-uploads, this just
// flags the booking -- the scheduler (poll-and-recap.js) is what actually
// respects the pushed-out deadline on its next run.
export async function POST(req, { params }) {
  const { eventId } = params;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, tier, status, uploads_closed_at, deadline_extension_hours")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (booking.tier !== "keepsake") {
    return NextResponse.json({ error: "Deadline extensions are a Luxe-tier perk." }, { status: 400 });
  }

  if (booking.status !== "collecting") {
    return NextResponse.json(
      { error: "This event isn't currently collecting uploads, so there's no deadline to extend." },
      { status: 400 }
    );
  }

  if (booking.uploads_closed_at) {
    return NextResponse.json({ error: "Uploads are already closed for this event." }, { status: 400 });
  }

  if (booking.deadline_extension_hours > 0) {
    return NextResponse.json({ success: true, deadlineExtensionHours: booking.deadline_extension_hours, alreadyExtended: true });
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ deadline_extension_hours: EXTENSION_HOURS })
    .eq("id", booking.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to extend deadline" }, { status: 500 });
  }

  return NextResponse.json({ success: true, deadlineExtensionHours: EXTENSION_HOURS });
}
