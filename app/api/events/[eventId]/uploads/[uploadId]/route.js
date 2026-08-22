import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// Signature/Luxe only, matching what those tiers actually advertise --
// same list as SOCIAL_CUT_ELIGIBLE_TIERS elsewhere (app/qr/[slug]/page.jsx,
// app/booking/page.jsx).
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];

export async function PATCH(req, { params }) {
  const { eventId, uploadId } = params;

  const { success } = await checkRateLimit("event-photos", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, tier")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier)) {
    return NextResponse.json({ error: "Social cuts aren't available on this tier" }, { status: 400 });
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
