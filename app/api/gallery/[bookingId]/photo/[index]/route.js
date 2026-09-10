import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getFileStream, getFileBuffer } from "@/lib/storage";
import { applyPolaroidFrame } from "@/lib/photo-frame";
import { checkRateLimit } from "@/lib/rateLimit";

// Streams a single gallery photo back through our own server, rather than
// the direct presigned R2 URL the main gallery route hands out for the
// plain case -- the only reason this route exists is ?style=polaroid,
// which a presigned URL can't do (R2 serves the stored bytes as-is, so
// framing a photo means fetching, compositing, and re-serving it
// ourselves). Public/unauthenticated, same as the rest of the gallery API --
// gated only by knowing the booking id and a valid photo index.
export async function GET(req, { params }) {
  const { bookingId, index } = await params;
  const photoIndex = Number.parseInt(index, 10);
  if (!Number.isInteger(photoIndex) || photoIndex < 0) {
    return NextResponse.json({ error: "Invalid photo index" }, { status: 400 });
  }

  // Higher allowance than download-all's -- a host downloading a batch of
  // selected photos fires one request per photo (staggered, not
  // simultaneous -- see the gallery page's triggerStaggeredDownloads), so a
  // few dozen in a minute is a normal single action here, not abuse.
  const { success } = await checkRateLimit("gallery-download-photo", req, { requests: 120, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  // Base + try/catch because req.url isn't guaranteed absolute -- same
  // defensive parse as hostTokenFromRequest (lib/hostToken.js).
  let style = "plain";
  try {
    style = new URL(req?.url ?? "", "http://localhost").searchParams.get("style") === "polaroid" ? "polaroid" : "plain";
  } catch {}

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_name")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("gallery_photo_keys")
    .eq("booking_id", bookingId)
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const photoKeys = deliverable?.gallery_photo_keys || [];
  const key = photoKeys[photoIndex];
  if (!key) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const eventSlug = (booking.host_name || "recap").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filename = `${eventSlug}-photo-${photoIndex + 1}${style === "polaroid" ? "-polaroid" : ""}.jpg`;

  try {
    if (style === "polaroid") {
      const framed = await applyPolaroidFrame(await getFileBuffer(key));
      return new NextResponse(framed, {
        headers: { "Content-Type": "image/jpeg", "Content-Disposition": `attachment; filename="${filename}"` },
      });
    }
    const stream = await getFileStream(key);
    return new NextResponse(stream, {
      headers: { "Content-Type": "image/jpeg", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch (err) {
    console.error(`Failed to serve photo ${key} for booking ${bookingId}:`, err.message);
    return NextResponse.json({ error: "Failed to download photo" }, { status: 500 });
  }
}
