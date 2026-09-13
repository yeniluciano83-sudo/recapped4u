import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { getFileBuffer } from "@/lib/storage";
import { buildRecapCard } from "@/lib/recapCard.js";
import { captureError } from "@/lib/sentry";

// Generates the host's "your recap is ready" share card -- a real gallery
// photo from the event with the event details and a QR/link to the
// gallery baked in, the same idea as app/api/invite/[slug]/route.js but
// for the delivery side instead of the pre-event invite. Public and
// unauthenticated on purpose, same trust model as the gallery route
// itself (app/api/gallery/[bookingId]/route.js): this is the link/image a
// host shares onward, not something only they should be able to fetch.
//
// Uses the first gallery photo, not the video's own poster frame -- the
// poster is deliberately a screenshot of the video's intro title card
// (see uploadPosterFor's own comment in scripts/auto-recap.js: "landing
// the poster ON the card matches what actually plays first"), which
// already has "<host>'s <event type>" burned into it. Confirmed live:
// using it here doubled that same text, once from the card's own baked-in
// copy and once from this card's own overlay, in two different fonts at
// two different sizes, badly misaligned. A real gallery photo has no
// baked-in text to collide with, and shows the actual event besides.
//
// Usage: GET /api/recap-card/[bookingId] -> returns a JPEG image
export async function GET(req, { params }) {
  const { bookingId } = await params;

  const { success } = await checkRateLimit("recap-card", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_name, event_type")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: deliverable, error: deliverableError } = await supabase
    .from("deliverables")
    .select("gallery_photo_keys, full_video_poster_key, social_video_poster_keys")
    .eq("booking_id", bookingId)
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Falls back to a poster frame only in the unlikely event a delivered
  // booking somehow has no gallery photos at all -- still better than no
  // card. Not ready yet (no deliverable row, or a render still in progress
  // with none of these populated) reads as 404, same as the gallery
  // route's own "not ready" case, rather than a card built around a
  // missing image.
  const photoKey = deliverable?.gallery_photo_keys?.[0] || deliverable?.full_video_poster_key || deliverable?.social_video_poster_keys?.[0];
  if (deliverableError || !photoKey) {
    return NextResponse.json({ error: "Recap not ready yet" }, { status: 404 });
  }

  try {
    const photoBuffer = await getFileBuffer(photoKey);
    const cardBuffer = await buildRecapCard({
      hostName: booking.host_name,
      eventType: booking.event_type,
      galleryUrl: `${process.env.APP_URL}/gallery/${bookingId}`,
      photoBuffer,
    });

    return new NextResponse(cardBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="recapped-recap-${bookingId}.jpg"`,
      },
    });
  } catch (err) {
    console.error("Recap card generation failed:", err);
    captureError(err, { tags: { route: "recap-card" }, extra: { bookingId } });
    return NextResponse.json({ error: "Recap card generation failed" }, { status: 500 });
  }
}
