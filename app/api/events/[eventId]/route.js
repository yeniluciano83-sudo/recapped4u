import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";

// eventId here is the booking's upload_slug (the short code in the QR/link URL)
//
// GET stays open on purpose: the guest upload page (app/event/[eventId]) needs
// the event's name and deadline to render at all, and every guest legitimately
// holds the slug. PATCH below is host-only and is gated accordingly.
export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-info", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, upload_slug, status, tier, uploads_closed_at, social_style, deadline_extension_hours, processing_started_at, delivery_format")
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
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-info", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { socialStyle } = await req.json();

  if (socialStyle !== null && !VALID_STYLES.includes(socialStyle)) {
    return NextResponse.json({ error: "Invalid style" }, { status: 400 });
  }

  // Resolve the booking before mutating so there's an id to verify the host
  // token against -- social_style drives how the whole social cut is edited,
  // so it's the host's call, not any guest holding the QR link.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("upload_slug", eventId)
    .maybeSingle();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({ social_style: socialStyle })
    .eq("id", booking.id)
    .select("social_style")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, social_style: data.social_style });
}
