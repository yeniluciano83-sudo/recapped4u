import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(req, { params }) {
  const { bookingId } = params;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("*")
    .eq("booking_id", bookingId)
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deliverable) {
    return NextResponse.json({ booking, deliverable: null, photos: [] });
  }

  const [fullVideoUrl, socialVideoUrl, ...photoUrls] = await Promise.all([
    deliverable.full_video_key ? getSignedDownloadUrl(deliverable.full_video_key, 86400) : null,
    deliverable.social_video_key ? getSignedDownloadUrl(deliverable.social_video_key, 86400) : null,
    ...(deliverable.gallery_photo_keys || []).map((k) => getSignedDownloadUrl(k, 86400)),
  ]);

  return NextResponse.json({
    booking,
    deliverable: { full_video_url: fullVideoUrl, social_video_url: socialVideoUrl },
    photos: photoUrls,
  });
}
