import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(req, { params }) {
  const { eventId, uploadId } = params;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { mustIncludeSocial } = await req.json();

  // Scope the update to this booking's own uploads -- eventId (upload_slug)
  // is the only credential a host has, so it must gate which upload rows
  // they're allowed to touch, not just which booking they can view.
  const { data, error } = await supabase
    .from("uploads")
    .update({ must_include_social: Boolean(mustIncludeSocial) })
    .eq("id", uploadId)
    .eq("booking_id", booking.id)
    .select()
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Photo not found for this event" }, { status: 404 });
  }

  return NextResponse.json({ success: true, mustIncludeSocial: data.must_include_social });
}
