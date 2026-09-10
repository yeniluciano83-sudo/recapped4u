import { NextResponse } from "next/server";
import { Readable } from "stream";
import archiver from "archiver";
import { supabase } from "@/lib/supabase";
import { getFileStream, getFileBuffer } from "@/lib/storage";
import { applyPolaroidFrame } from "@/lib/photo-frame";
import { buildGridSheet, buildMasonrySheet, GRID_PHOTOS_PER_SHEET, MASONRY_PHOTOS_PER_SHEET } from "@/lib/photo-collage";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const VALID_STYLES = ["plain", "polaroid", "grid", "masonry"];

// Public, unauthenticated route (same as the main gallery route this
// supplements) -- gated only by knowing the booking's id. Heavier per
// request than that route (streams every photo from R2 and re-compresses
// it), so rate-limited unlike that one.
export async function GET(req, { params }) {
  const { bookingId } = await params;
  // Base + try/catch because req.url isn't guaranteed absolute -- same
  // defensive parse as hostTokenFromRequest (lib/hostToken.js) -- an
  // unparseable URL here should read as "no style requested" (the plain
  // default), not a 500.
  let style = "plain";
  try {
    const requested = new URL(req?.url ?? "", "http://localhost").searchParams.get("style");
    style = VALID_STYLES.includes(requested) ? requested : "plain";
  } catch {}

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

  // Fire-and-forget. Every style processes one photo (or, for grid/masonry,
  // one sheet's worth of photos) at a time -- never the whole gallery
  // buffered at once, which matters here specifically because
  // Spotlight/Luxe galleries can run into the thousands of photos. A single
  // bad photo (an R2 hiccup, a missing object) is logged and skipped rather
  // than failing the whole zip -- the guest still gets everything else that
  // downloaded fine.
  (async () => {
    if (style === "grid" || style === "masonry") {
      // Grid/Masonry aren't per-photo styles like Polaroid -- they're page
      // LAYOUTS, so there's nothing to bake into a single photo. What
      // exports is a contact-sheet-style collage: several photos composited
      // onto one image, chunked into sheets since a 2000-photo gallery
      // can't sanely fit on one. See lib/photo-collage.js.
      const perSheet = style === "grid" ? GRID_PHOTOS_PER_SHEET : MASONRY_PHOTOS_PER_SHEET;
      const buildSheet = style === "grid" ? buildGridSheet : buildMasonrySheet;
      let sheetNum = 0;
      for (let start = 0; start < photoKeys.length; start += perSheet) {
        sheetNum += 1;
        const batchKeys = photoKeys.slice(start, start + perSheet);
        try {
          // Sequential within a batch too (not Promise.all) -- bounds peak
          // memory to roughly one sheet's worth of decoded photos, not the
          // whole batch's worth landing in memory simultaneously.
          const buffers = [];
          for (const key of batchKeys) buffers.push(await getFileBuffer(key));
          const sheet = await buildSheet(buffers);
          archive.append(sheet, { name: `${eventSlug}-${style}-sheet-${sheetNum}.jpg` });
        } catch (err) {
          console.error(`Failed to build ${style} sheet ${sheetNum} for booking ${bookingId}:`, err.message);
        }
      }
    } else {
      for (let i = 0; i < photoKeys.length; i++) {
        try {
          if (style === "polaroid") {
            const framed = await applyPolaroidFrame(await getFileBuffer(photoKeys[i]));
            archive.append(framed, { name: `${eventSlug}-photo-${i + 1}.jpg` });
          } else {
            const stream = await getFileStream(photoKeys[i]);
            archive.append(stream, { name: `${eventSlug}-photo-${i + 1}.jpg` });
          }
        } catch (err) {
          console.error(`Failed to add photo ${photoKeys[i]} to zip for booking ${bookingId}:`, err.message);
        }
      }
    }
    archive.finalize();
  })();

  return new NextResponse(Readable.toWeb(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${eventSlug}-photos${style === "plain" ? "" : `-${style}`}.zip"`,
    },
  });
}
