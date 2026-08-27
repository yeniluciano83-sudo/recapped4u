import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// Spotlight/Luxe only, matching what those tiers actually advertise --
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

  const body = await req.json();
  const updates = {};

  // must_include (main video, every tier) and must_include_social (social
  // cut, Spotlight/Luxe only) are independent toggles -- only gate the one
  // that's actually tier-restricted.
  if (Object.prototype.hasOwnProperty.call(body, "mustInclude")) {
    updates.must_include = Boolean(body.mustInclude);
  }
  if (Object.prototype.hasOwnProperty.call(body, "mustIncludeSocial")) {
    if (!SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier)) {
      return NextResponse.json({ error: "Social cuts aren't available on this tier" }, { status: 400 });
    }
    updates.must_include_social = Boolean(body.mustIncludeSocial);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Scope the update to this booking's own uploads -- eventId (upload_slug)
  // is the only credential a host has, so it must gate which upload rows
  // they're allowed to touch, not just which booking they can view.
  const { data, error } = await supabase
    .from("uploads")
    .update(updates)
    .eq("id", uploadId)
    .eq("booking_id", booking.id)
    .select()
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Photo not found for this event" }, { status: 404 });
  }

  return NextResponse.json({ success: true, mustInclude: data.must_include, mustIncludeSocial: data.must_include_social });
}
