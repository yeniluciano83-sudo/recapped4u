import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadFile, buildStorageKey, deleteFile } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";

// Generous enough for real phone photos (even large ones) and real guest
// counts, while closing off a scripted client pushing unbounded fake
// uploads at a guessed/leaked event link and running up R2 storage cost.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
// Classic's pricing copy caps it below Signature/Luxe; anything not listed
// here (Free) falls back to the same 500-photo anti-abuse ceiling those two
// tiers use -- Free's real cap is its 20-photo curated gallery downstream,
// not this raw-upload count.
const MAX_UPLOADS_PER_EVENT = { standard: 350 };
const DEFAULT_MAX_UPLOADS_PER_EVENT = 500;

export async function POST(req, { params }) {
  const { eventId } = params;

  // upload_slug is the only credential gating this route -- generous
  // enough for a real guest uploading many photos back-to-back (one
  // request per file, see the client), tight enough to blunt a script
  // hammering a guessed or leaked slug.
  const { success } = await checkRateLimit("event-upload", req, { requests: 60, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, tier, uploads_closed_at, status")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "This event has been cancelled." }, { status: 400 });
  }

  if (booking.status === "pending_confirmation") {
    return NextResponse.json({ error: "This event hasn't been activated yet." }, { status: 400 });
  }

  if (booking.uploads_closed_at) {
    return NextResponse.json(
      { error: "The host has closed uploads for this event -- the recap is already being put together." },
      { status: 400 }
    );
  }

  try {
    const formData = await req.formData();
    const uploaderName = formData.get("uploaderName") || "Guest";
    const files = formData.getAll("files");

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Photos only -- the upload pages already restrict file pickers to
    // image/*, but that's a client-side hint, not a guarantee, so it's
    // still enforced here.
    const nonImage = files.find((file) => !file.type.startsWith("image/"));
    if (nonImage) {
      return NextResponse.json({ error: "Only photos can be uploaded." }, { status: 400 });
    }

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      return NextResponse.json({ error: "Photos must be under 25MB each." }, { status: 400 });
    }

    const { count: existingCount } = await supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id);

    const uploadLimit = MAX_UPLOADS_PER_EVENT[booking.tier] ?? DEFAULT_MAX_UPLOADS_PER_EVENT;
    if ((existingCount || 0) + files.length > uploadLimit) {
      return NextResponse.json({ error: "This event has reached its upload limit. Please reach out to us for help." }, { status: 400 });
    }

    const results = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = buildStorageKey({ bookingId: booking.id, kind: "raw", filename: file.name });
      await uploadFile(key, buffer, file.type);

      const { data: uploadRow, error: insertError } = await supabase
        .from("uploads")
        .insert({
          booking_id: booking.id,
          uploader_name: uploaderName,
          storage_key: key,
          file_type: "photo",
        })
        .select()
        .single();

      if (insertError) {
        // The file already landed in R2 -- without this, a DB insert
        // failure orphans it there (invisible to curation and the 30-day
        // purge job, which both key off the `uploads` row) while the guest
        // was never told anything went wrong.
        console.error(`Upload row insert failed for booking ${booking.id}, key ${key}:`, insertError.message);
        try {
          await deleteFile(key);
        } catch (cleanupErr) {
          console.error(`Failed to clean up orphaned R2 object ${key}:`, cleanupErr.message);
        }
      } else {
        results.push(uploadRow);
      }
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    }

    // First guest upload moves the event from "booked"/"collecting" if not already there
    await supabase
      .from("bookings")
      .update({ status: "collecting" })
      .eq("id", booking.id)
      .neq("status", "editing")
      .neq("status", "delivered")
      .neq("status", "cancelled");

    return NextResponse.json({ uploaded: results.length });
  } catch (err) {
    console.error(`Upload failed for booking ${booking.id}:`, err);
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}
