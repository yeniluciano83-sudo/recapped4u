import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { bookingId } = params;

  // Public, unauthenticated route (this is the link hosts share with guests)
  // -- select only the fields the gallery view actually renders, not "*".
  // upload_slug in particular must never end up here: it's the sole
  // credential gating cancel/reschedule/close-uploads/extend-deadline, and
  // this response would otherwise hand it to anyone with the gallery link.
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, status, tier, style, delivery_format, gallery_template, gallery_expires_at")
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
  // Older deliverable rows predate social_video_keys and only have the
  // singular field -- fall back to it so their gallery still shows a cut.
  const socialKeys = deliverable.social_video_keys?.length ? deliverable.social_video_keys : [deliverable.social_video_key].filter(Boolean);

  const [fullVideoUrl, noRoastVideoUrl, fullVideoDownloadUrl, noRoastVideoDownloadUrl, socialVideoUrls, socialVideoDownloadUrls, photoUrls, photoDownloadUrls] = await Promise.all([
    deliverable.full_video_key ? getSignedDownloadUrl(deliverable.full_video_key, 86400) : null,
    deliverable.full_video_no_roast_key ? getSignedDownloadUrl(deliverable.full_video_no_roast_key, 86400) : null,
    deliverable.full_video_key ? getSignedDownloadUrl(deliverable.full_video_key, 86400, `${eventSlug}-recap-full.mp4`) : null,
    deliverable.full_video_no_roast_key ? getSignedDownloadUrl(deliverable.full_video_no_roast_key, 86400, `${eventSlug}-recap-full-no-roast.mp4`) : null,
    Promise.all(socialKeys.map((k) => getSignedDownloadUrl(k, 86400))),
    Promise.all(socialKeys.map((k, i) => getSignedDownloadUrl(k, 86400, `${eventSlug}-recap-social-${i + 1}.mp4`))),
    Promise.all(photoKeys.map((k) => getSignedDownloadUrl(k, 86400))),
    Promise.all(photoKeys.map((k, i) => getSignedDownloadUrl(k, 86400, `${eventSlug}-photo-${i + 1}.jpg`))),
  ]);

  return NextResponse.json({
    booking,
    deliverable: {
      full_video_url: fullVideoUrl,
      full_video_no_roast_url: noRoastVideoUrl,
      full_video_download_url: fullVideoDownloadUrl,
      full_video_no_roast_download_url: noRoastVideoDownloadUrl,
      social_video_urls: socialVideoUrls,
      social_video_download_urls: socialVideoDownloadUrls,
    },
    photos: photoUrls,
    photo_download_urls: photoDownloadUrls,
  });
}
