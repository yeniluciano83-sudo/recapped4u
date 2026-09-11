import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";

const VALID_RESPONSES = ["yes", "no", "maybe"];

// POST is public -- any guest holding the event slug can RSVP, same trust
// model as uploading a photo (see app/event/[eventId]/page.jsx). GET is
// host-only: the response list is the host's guest list, not something
// every guest holding the QR link should be able to read, so it's gated the
// same way the social-style PATCH on the parent route is.
export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("rsvp", req, { requests: 20, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { guestName, response } = await req.json().catch(() => ({}));

  if (!VALID_RESPONSES.includes(response)) {
    return NextResponse.json({ error: "Invalid RSVP response" }, { status: 400 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("upload_slug", eventId)
    .maybeSingle();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const trimmedName = (guestName || "").trim().slice(0, 80);

  // A named guest upserts against the partial unique index in migration 038
  // (booking_id, guest_name) -- re-tapping a different button updates their
  // existing row instead of piling up duplicates. An anonymous submission
  // has no identity to dedupe against, so it's always a fresh row, same as
  // an anonymous photo upload.
  const { error } = trimmedName
    ? await supabase.from("rsvps").upsert(
        { booking_id: booking.id, guest_name: trimmedName, response },
        { onConflict: "booking_id,guest_name" }
      )
    : await supabase.from("rsvps").insert({ booking_id: booking.id, guest_name: null, response });

  if (error) {
    return NextResponse.json({ error: "Failed to save your RSVP. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Host-only summary -- counts plus the actual name list.
export async function GET(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("rsvp", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

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

  const { data: rsvps, error } = await supabase
    .from("rsvps")
    .select("guest_name, response, created_at")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load RSVPs" }, { status: 500 });
  }

  const counts = { yes: 0, no: 0, maybe: 0 };
  for (const r of rsvps) counts[r.response] += 1;

  return NextResponse.json({ counts, responses: rsvps });
}
