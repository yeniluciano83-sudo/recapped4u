import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";

// Lists a booking's uploaded photos for the host's must-include picker.
// Photos only. Two independent star flags: must_include (guarantees a spot
// in the main recap video, every tier) and must_include_social (guarantees
// a spot in the social cut specifically, Spotlight/Luxe only).
export async function GET(req, { params }) {
  const { eventId } = params;

  const { success } = await checkRateLimit("event-photos", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: uploads, error } = await supabase
    .from("uploads")
    .select("id, storage_key, must_include, must_include_social, uploaded_at")
    .eq("booking_id", booking.id)
    .eq("file_type", "photo")
    .order("uploaded_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load photos" }, { status: 500 });
  }

  const photos = await Promise.all(
    (uploads || []).map(async (u) => ({
      id: u.id,
      mustInclude: u.must_include,
      mustIncludeSocial: u.must_include_social,
      url: await getSignedDownloadUrl(u.storage_key, 3600),
    }))
  );

  return NextResponse.json({ photos });
}
