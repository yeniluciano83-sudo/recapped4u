import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildStorageKey, getSignedUploadUrl } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { getUploadLimit } from "@/lib/uploadLimits";

// R2 accepts a single PUT up to 5GiB -- this ceiling exists purely to keep
// a guessed/leaked event link from becoming a storage-cost abuse vector,
// not because of any technical constraint. Photo bytes go straight from
// the browser to R2 (see uploadOneFile in both upload pages) and never
// touch this function, so unlike the old single-request route, this
// number is actually enforceable -- confirm/route.js re-checks the real
// object size once the PUT lands, since a presigned PUT URL can't
// cryptographically constrain the size the way an S3 POST policy would.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-upload-presign", req, { requests: 60, windowSeconds: 60 });
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

  const body = await req.json().catch(() => ({}));
  const { filename, contentType, fileSize, clientUploadId } = body;

  if (!filename || !contentType) {
    return NextResponse.json({ error: "Missing file details." }, { status: 400 });
  }

  // Photos only -- the upload pages already restrict file pickers to
  // image/*, but that's a client-side hint, not a guarantee, so it's still
  // enforced here. scope: "file" tells the client this rejection is about
  // this one photo, not the event as a whole -- it shouldn't abort the
  // rest of a guest's batch, just this file. See uploadOneFile/handleUpload
  // in both upload pages.
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Only photos can be uploaded.", scope: "file" }, { status: 400 });
  }

  if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "This photo is too large to upload. Try a smaller version.", scope: "file" }, { status: 400 });
  }

  // Already uploaded from an earlier attempt (this request's own retry, or
  // the guest re-tapping "Add to the recap") -- skip straight to done
  // instead of issuing a new presigned URL for a photo that's already in.
  if (clientUploadId) {
    const { data: existing } = await supabase
      .from("uploads")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("client_upload_id", clientUploadId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ alreadyUploaded: true });
    }
  }

  const { count: existingCount } = await supabase
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id);

  const uploadLimit = getUploadLimit(booking.tier);
  if ((existingCount || 0) + 1 > uploadLimit) {
    return NextResponse.json({ error: "This event has reached its upload limit. Please reach out to us for help." }, { status: 400 });
  }

  const key = buildStorageKey({ bookingId: booking.id, kind: "raw", filename });
  const uploadUrl = await getSignedUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl, key });
}
