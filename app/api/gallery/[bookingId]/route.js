import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

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

  const eventSlug = (booking.host_name || "recap").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const photoKeys = deliverable.gallery_photo_keys || [];

  const [
    fullVideoUrl, socialVideoUrl, ...photoUrls
  ] = await Promise.all([
    deliverable.full_video_key ? getSignedDownloadUrl(deliverable.full_video_key, 86400) : null,
    deliverable.social_video_key ? getSignedDownloadUrl(deliverable.social_video_key, 86400) : null,
    ...photoKeys.map((k) => getSignedDownloadUrl(k, 86400)),
  ]);

  const [
    fullVideoDownloadUrl, socialVideoDownloadUrl, ...photoDownloadUrls
  ] = await Promise.all([
    deliverable.full_video_key ? getSignedDownloadUrl(deliverable.full_video_key, 86400, `${eventSlug}-recap-full.mp4`) : null,
    deliverable.social_video_key ? getSignedDownloadUrl(deliverable.social_video_key, 86400, `${eventSlug}-recap-social.mp4`) : null,
    ...photoKeys.map((k, i) => getSignedDownloadUrl(k, 86400, `${eventSlug}-photo-${i + 1}.jpg`)),
  ]);

  return NextResponse.json({
    booking,
    deliverable: {
      full_video_url: fullVideoUrl,
      social_video_url: socialVideoUrl,
      full_video_download_url: fullVideoDownloadUrl,
      social_video_download_url: socialVideoDownloadUrl,
    },
    photos: photoUrls,
    photo_download_urls: photoDownloadUrls,
  });
}
