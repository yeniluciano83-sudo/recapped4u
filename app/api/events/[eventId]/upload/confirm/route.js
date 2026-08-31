import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteFile, getObjectSize } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { captureError } from "@/lib/sentry";

// Keep in sync with presign/route.js's MAX_FILE_SIZE_BYTES -- this is the
// real enforcement point, since a presigned PUT URL can't cryptographically
// constrain the uploaded size the way an S3 POST policy would.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-upload-confirm", req, { requests: 60, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, uploads_closed_at, status")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Re-checked here too (not just at presign) -- status can change in the
  // window between presign and confirm, since this is now 3 round trips
  // instead of 1.
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "This event has been cancelled." }, { status: 400 });
  }
  if (booking.status === "pending_confirmation") {
    return NextResponse.json({ error: "This event hasn't been activated yet." }, { status: 400 });
  }
  if (booking.status === "analyzing" || booking.status === "editing" || booking.status === "delivered") {
    return NextResponse.json(
      { error: "This event's recap has already started processing -- new uploads can no longer be added." },
      { status: 400 }
    );
  }
  if (booking.uploads_closed_at) {
    return NextResponse.json(
      { error: "The host has closed uploads for this event -- the recap is already being put together." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { key, clientUploadId, uploaderName } = body;

  if (!key) {
    return NextResponse.json({ error: "Missing upload key." }, { status: 400 });
  }

  // The presigned PUT can still be racing (R2 committed it, but this
  // confirm call arrived first) or may never have landed at all (dropped
  // connection mid-upload) -- either way, "not found yet" is retryable,
  // not a hard failure. The client's retry loop re-presigns and tries
  // again from scratch.
  const size = await getObjectSize(key);
  if (size == null) {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    try {
      await deleteFile(key);
    } catch (cleanupErr) {
      console.error(`Failed to clean up oversized R2 object ${key}:`, cleanupErr.message);
    }
    return NextResponse.json({ error: "This photo is too large to upload. Try a smaller version.", scope: "file" }, { status: 400 });
  }

  let { data: uploadRow, error: insertError } = await supabase
    .from("uploads")
    .insert({
      booking_id: booking.id,
      uploader_name: uploaderName || "Guest",
      storage_key: key,
      file_type: "photo",
      ...(clientUploadId ? { client_upload_id: clientUploadId } : {}),
    })
    .select()
    .single();

  // PGRST204 here means the client_upload_id column doesn't exist yet
  // (migration 021 not applied) -- fall back to a plain insert so the
  // actual upload (the thing that must never break) still succeeds;
  // idempotency just doesn't kick in until the migration runs.
  if (insertError && insertError.code === "PGRST204" && clientUploadId) {
    console.error("uploads.client_upload_id column missing (migration 021 not yet applied) -- inserting without idempotency tracking");
    ({ data: uploadRow, error: insertError } = await supabase
      .from("uploads")
      .insert({ booking_id: booking.id, uploader_name: uploaderName || "Guest", storage_key: key, file_type: "photo" })
      .select()
      .single());
  }

  if (insertError) {
    // Unique violation on (booking_id, client_upload_id) means a
    // near-simultaneous duplicate request already won the race -- this one
    // lost, so it's a genuine duplicate, not a real error. Return the
    // winner instead of failing the guest's upload over what is, from
    // their side, the exact same photo having already made it in.
    if (insertError.code === "23505" && clientUploadId) {
      const { data: winner } = await supabase
        .from("uploads")
        .select()
        .eq("booking_id", booking.id)
        .eq("client_upload_id", clientUploadId)
        .maybeSingle();
      if (winner) {
        try {
          await deleteFile(key);
        } catch (cleanupErr) {
          console.error(`Failed to clean up duplicate-race R2 object ${key}:`, cleanupErr.message);
        }
        return NextResponse.json({ upload: winner });
      }
    }
    // The file already landed in R2 -- without this, a DB insert failure
    // orphans it there (invisible to curation and the 30-day purge job,
    // which both key off the `uploads` row).
    console.error(`Upload row insert failed for booking ${booking.id}, key ${key}:`, insertError.message);
    captureError(insertError, { tags: { route: "events.upload-confirm" }, extra: { bookingId: booking.id, key } });
    try {
      await deleteFile(key);
    } catch (cleanupErr) {
      console.error(`Failed to clean up orphaned R2 object ${key}:`, cleanupErr.message);
    }
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  // First guest upload moves the event from "booked"/"collecting" if not already there
  await supabase
    .from("bookings")
    .update({ status: "collecting" })
    .eq("id", booking.id)
    .neq("status", "analyzing")
    .neq("status", "editing")
    .neq("status", "delivered")
    .neq("status", "cancelled");

  return NextResponse.json({ upload: uploadRow });
}
