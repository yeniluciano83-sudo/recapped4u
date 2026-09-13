import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { getFileBuffer } from "@/lib/storage";
import { captureError } from "@/lib/sentry";

// Serves the short, watermarked public teaser clip (see buildTeaserClip in
// lib/video-assemble.js) through our own domain rather than a presigned R2
// link -- R2 doesn't set Access-Control-Allow-Origin, so the gallery
// page's share button (which needs to fetch the actual bytes to attach as
// a File to navigator.share, the same file-share mechanics as
// handleShareInvite/handleShareRecap) couldn't read a cross-origin R2 URL
// at all. Proxying a few seconds of video through this route once per
// share is cheap; this would NOT be the right call for the full ~290MB
// video (see the gallery page's own handleShareVideo comment for why that
// one stays a link, never a file).
//
// Public and unauthenticated, same trust model as the gallery route
// itself: this is the file a host shares onward, not something only they
// should be able to fetch.
// Usage: GET /api/teaser/[bookingId] -> returns an MP4
export async function GET(req, { params }) {
  const { bookingId } = await params;

  const { success } = await checkRateLimit("teaser", req, { requests: 20, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: deliverable, error } = await supabase
    .from("deliverables")
    .select("teaser_video_key")
    .eq("booking_id", bookingId)
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No teaser is a real, expected state (Free/Highlight bookings, or any
  // deliverable rendered before this feature existed) -- not an error.
  if (error || !deliverable?.teaser_video_key) {
    return NextResponse.json({ error: "No teaser available for this event" }, { status: 404 });
  }

  try {
    const buffer = await getFileBuffer(deliverable.teaser_video_key);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="recapped-teaser-${bookingId}.mp4"`,
      },
    });
  } catch (err) {
    console.error("Teaser fetch failed:", err);
    captureError(err, { tags: { route: "teaser" }, extra: { bookingId } });
    return NextResponse.json({ error: "Failed to load teaser" }, { status: 500 });
  }
}
