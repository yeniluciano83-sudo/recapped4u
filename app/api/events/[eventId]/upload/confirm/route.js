import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteFile, getObjectSize } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { captureError } from "@/lib/sentry";
import { getUploadLimit } from "@/lib/uploadLimits";

// Keep in sync with presign/route.js's MAX_FILE_SIZE_BYTES -- this is the
// real enforcement point, since a presigned PUT URL can't cryptographically
// constrain the uploaded size the way an S3 POST policy would.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(req, { params }) {
  const { eventId } = await params;

  // 600/min per client IP, same reasoning as presign/route.js -- a shared
  // event Wi-Fi means many guests share one budget, and the per-event
  // upload cap is the real leaked-link backstop, not this.
  const { success } = await checkRateLimit("event-upload-confirm", req, { requests: 600, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, uploads_closed_at, status, tier, email, host_name, event_type, upload_slug, upload_cap_notified_at")
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
    // UPCAP is raised by the uploads_enforce_cap trigger (migration 033) when
    // this booking is already at its tier's limit. presign/route.js checks the
    // same cap first, so reaching here means the count moved underneath us --
    // a genuine concurrent-upload race, which is exactly what the trigger
    // exists to catch and what the route alone could never enforce.
    //
    // Not a 500: nothing is broken, the event is simply full. Cleaned up like
    // the oversized-file path above, since the object is already in R2 and an
    // uploads row is what makes it visible to curation and the purge job.
    // scope: "file" so the client fails this one photo instead of aborting the
    // guest's whole batch (see uploadOneFile in both upload pages).
    if (insertError.code === "UPCAP") {
      try {
        await deleteFile(key);
      } catch (cleanupErr) {
        console.error(`Failed to clean up over-cap R2 object ${key}:`, cleanupErr.message);
      }
      return NextResponse.json(
        { error: "This event has reached its upload limit. Please reach out to us for help.", scope: "file" },
        { status: 400 }
      );
    }

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

  // Tell the host the moment their event actually fills up, not the moment a
  // guest gets turned away by it -- that's this insert specifically, not
  // whichever one happens to be first to get rejected afterward. The
  // uploads_enforce_cap trigger (migration 033) serializes every insert for
  // this booking via a row lock, so exactly one insert's re-count below can
  // ever land on the cap: once it does, every later attempt is rejected by
  // the trigger before it can insert at all (the UPCAP branch above), so no
  // second request ever reaches this count query believing it's the one that
  // filled the event. upload_cap_notified_at is still checked as a cheap
  // extra guard, and it's what lets a host who deletes photos to free room
  // (see the DELETE handler on uploads/[uploadId]/route.js, which resets this
  // flag) get notified again on a later re-fill instead of just once ever.
  if (!booking.upload_cap_notified_at) {
    const cap = getUploadLimit(booking.tier);
    const { count: newCount } = await supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking.id);

    if (newCount === cap) {
      try {
        const { sendUploadCapReachedEmail } = await import("@/lib/email");
        await sendUploadCapReachedEmail({
          to: booking.email,
          hostName: booking.host_name,
          eventType: booking.event_type,
          tier: booking.tier,
          uploadSlug: booking.upload_slug,
          bookingId: booking.id,
        });
      } catch (err) {
        console.error(`Upload-cap-reached email failed for booking ${booking.id}:`, err.message);
        captureError(err, { tags: { route: "events.upload-confirm", email: "upload-cap-reached" }, extra: { bookingId: booking.id } });
      }
      await supabase.from("bookings").update({ upload_cap_notified_at: new Date().toISOString() }).eq("id", booking.id);
    }
  }

  return NextResponse.json({ upload: uploadRow });
}
