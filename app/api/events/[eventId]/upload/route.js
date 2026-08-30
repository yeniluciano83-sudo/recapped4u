import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadFile, buildStorageKey, deleteFile } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { getUploadLimit } from "@/lib/uploadLimits";
import { captureError } from "@/lib/sentry";

// Generous enough for real phone photos (even large ones) and real guest
// counts, while closing off a scripted client pushing unbounded fake
// uploads at a guessed/leaked event link and running up R2 storage cost.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(req, { params }) {
  const { eventId } = await params;

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

  // Catches a booking that reached its tier's natural deadline (as opposed
  // to the host manually closing early via close-uploads, which sets
  // uploads_closed_at below) -- the scheduler claims those straight into
  // "analyzing" without ever touching uploads_closed_at, so relying on that
  // column alone left a gap where uploads could still land mid-pipeline-run
  // or even after delivery, invisible to the recap that had already run.
  // "analyzing" specifically: its raw photos were already pulled into a
  // Claude batch by submitAnalysisBatch (scripts/auto-recap.js) at the
  // moment of submission -- an upload landing after that would silently
  // never get analyzed at all, not just missed by this run.
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

  try {
    const formData = await req.formData();
    const uploaderName = formData.get("uploaderName") || "Guest";
    const files = formData.getAll("files");
    // Stable per-file key the client derives from the File object itself
    // (name + size + lastModified) -- present on every retry of the SAME
    // file, whether that's this route's own client's automatic retry or a
    // guest re-tapping "Add to the recap" after a lost/misread response.
    // Parallel array to `files`; may be shorter/empty for an older client
    // build that hasn't been redeployed yet, so index access below is
    // defensive rather than assumed 1:1.
    const clientUploadIds = formData.getAll("clientUploadId");

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

    const uploadLimit = getUploadLimit(booking.tier);
    if ((existingCount || 0) + files.length > uploadLimit) {
      return NextResponse.json({ error: "This event has reached its upload limit. Please reach out to us for help." }, { status: 400 });
    }

    // Look up any of this batch's client_upload_ids that already made it
    // in from an earlier attempt, so a retried file skips straight to
    // "already have it" instead of re-uploading to R2 and inserting a
    // duplicate row. Tolerates migration 021 (adds the client_upload_id
    // column) not having run yet -- idsToCheck.length guards against
    // querying with an empty .in() list, and a query error here (missing
    // column) just means dedup doesn't happen this request, not a hard
    // failure that would block uploads.
    const idsToCheck = clientUploadIds.filter(Boolean);
    let existingByClientId = new Map();
    let clientUploadIdColumnMissing = false;
    if (idsToCheck.length) {
      const { data: existingRows, error: lookupError } = await supabase
        .from("uploads")
        .select()
        .eq("booking_id", booking.id)
        .in("client_upload_id", idsToCheck);
      if (lookupError) {
        console.error("client_upload_id lookup failed (migration 021 may not be applied yet):", lookupError.message);
        clientUploadIdColumnMissing = true;
      } else {
        existingByClientId = new Map((existingRows || []).map((r) => [r.client_upload_id, r]));
      }
    }

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const clientUploadId = clientUploadIdColumnMissing ? null : clientUploadIds[i] || null;

      const existing = clientUploadId ? existingByClientId.get(clientUploadId) : null;
      if (existing) {
        results.push(existing);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const key = buildStorageKey({ bookingId: booking.id, kind: "raw", filename: file.name });
      await uploadFile(key, buffer, file.type);

      let { data: uploadRow, error: insertError } = await supabase
        .from("uploads")
        .insert({
          booking_id: booking.id,
          uploader_name: uploaderName,
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
          .insert({ booking_id: booking.id, uploader_name: uploaderName, storage_key: key, file_type: "photo" })
          .select()
          .single());
      }

      if (insertError) {
        // Unique violation on (booking_id, client_upload_id) means a
        // near-simultaneous duplicate request already won the race --
        // this one lost, so it's a genuine duplicate, not a real error.
        // Fetch and return the winner instead of failing the guest's
        // upload over what is, from their side, the exact same photo
        // having already made it in a moment ago.
        if (insertError.code === "23505" && clientUploadId) {
          const { data: winner } = await supabase
            .from("uploads")
            .select()
            .eq("booking_id", booking.id)
            .eq("client_upload_id", clientUploadId)
            .single();
          if (winner) {
            results.push(winner);
            try {
              await deleteFile(key);
            } catch (cleanupErr) {
              console.error(`Failed to clean up duplicate-race R2 object ${key}:`, cleanupErr.message);
            }
            continue;
          }
        }
        // The file already landed in R2 -- without this, a DB insert
        // failure orphans it there (invisible to curation and the 30-day
        // purge job, which both key off the `uploads` row) while the guest
        // was never told anything went wrong.
        console.error(`Upload row insert failed for booking ${booking.id}, key ${key}:`, insertError.message);
        captureError(insertError, { tags: { route: "events.upload" }, extra: { bookingId: booking.id, key } });
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
      .neq("status", "analyzing")
      .neq("status", "editing")
      .neq("status", "delivered")
      .neq("status", "cancelled");

    return NextResponse.json({ uploaded: results.length });
  } catch (err) {
    console.error(`Upload failed for booking ${booking.id}:`, err);
    captureError(err, { tags: { route: "events.upload" }, extra: { bookingId: booking.id } });
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}
