import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// eventId here is the booking's upload_slug (the short code in the QR/link URL)
export async function GET(req, { params }) {
  const { eventId } = params;

  const { success } = await checkRateLimit("event-info", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, upload_slug, status, tier, uploads_closed_at, social_style, deadline_extension_hours, processing_started_at")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { count } = await supabase
    .from("uploads")
    .select("*", { count: "exact", head: true })
    .eq("booking_id", booking.id);

  return NextResponse.json({ event: booking, uploadCount: count || 0 });
}

const VALID_STYLES = ["cinematic", "upbeat", "documentary", "retro", "highlight", "none"];

// Currently just used to let the host pick a separate theme for their
// social cut (Spotlight/Luxe) -- distinct from the PATCH on
// /api/bookings/[id], which is the staff dashboard's status-only endpoint.
export async function PATCH(req, { params }) {
  const { eventId } = params;

  const { success } = await checkRateLimit("event-info", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { socialStyle } = await req.json();

  if (socialStyle !== null && !VALID_STYLES.includes(socialStyle)) {
    return NextResponse.json({ error: "Invalid style" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({ social_style: socialStyle })
    .eq("upload_slug", eventId)
    .select("social_style")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, social_style: data.social_style });
}
