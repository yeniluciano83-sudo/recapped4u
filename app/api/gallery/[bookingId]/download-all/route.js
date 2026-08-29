import { NextResponse } from "next/server";
import { Readable } from "stream";
import archiver from "archiver";
import { supabase } from "@/lib/supabase";
import { getFileStream } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Public, unauthenticated route (same as the main gallery route this
// supplements) -- gated only by knowing the booking's id. Heavier per
// request than that route (streams every photo from R2 and re-compresses
// it), so rate-limited unlike that one.
export async function GET(req, { params }) {
  const { bookingId } = await params;

  const { success } = await checkRateLimit("gallery-download-all", req, { requests: 5, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

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
  if (photoKeys.length === 0) {
    return NextResponse.json({ error: "No photos available for this gallery." }, { status: 404 });
  }

  const eventSlug = (booking.host_name || "recap").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("warning", (err) => console.error(`Zip warning for booking ${bookingId}:`, err.message));
  archive.on("error", (err) => console.error(`Zip error for booking ${bookingId}:`, err.message));

  // Fire-and-forget: appends every photo as its own stream -- never
  // buffered whole into memory first, which matters here specifically
  // because Spotlight/Luxe galleries can run into the thousands of photos.
  // A single bad photo (an R2 hiccup, a missing object) is logged and
  // skipped rather than failing the whole zip -- the guest still gets
  // everything else that downloaded fine.
  (async () => {
    for (let i = 0; i < photoKeys.length; i++) {
      try {
        const stream = await getFileStream(photoKeys[i]);
        archive.append(stream, { name: `${eventSlug}-photo-${i + 1}.jpg` });
      } catch (err) {
        console.error(`Failed to add photo ${photoKeys[i]} to zip for booking ${bookingId}:`, err.message);
      }
    }
    archive.finalize();
  })();

  return new NextResponse(Readable.toWeb(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${eventSlug}-photos.zip"`,
    },
  });
}
