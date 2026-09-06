import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteFile } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";
import { captureError } from "@/lib/sentry";

// Spotlight/Luxe only, matching what those tiers actually advertise --
// same list as SOCIAL_CUT_ELIGIBLE_TIERS elsewhere (app/qr/[slug]/page.jsx,
// app/booking/page.jsx).
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];

export async function PATCH(req, { params }) {
  const { eventId, uploadId } = await params;

  const { success } = await checkRateLimit("event-photos", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, tier, delivery_format")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Must-include is the host's editorial control over their own recap --
  // a guest shouldn't be able to force or drop photos. See lib/hostToken.js.
  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  const body = await req.json();
  const updates = {};

  // must_include (main video, every tier) and must_include_social (social
  // cut, Spotlight/Luxe only) are independent toggles -- only gate the one
  // that's actually tier-restricted.
  if (Object.prototype.hasOwnProperty.call(body, "mustInclude")) {
    updates.must_include = Boolean(body.mustInclude);
  }
  if (Object.prototype.hasOwnProperty.call(body, "mustIncludeSocial")) {
    // Tier alone isn't enough -- a Spotlight/Luxe booking can still be
    // delivery_format "video_only", which skips social cuts entirely
    // regardless of tier (see finalizeDelivery's own check in
    // scripts/auto-recap.js). The host share page already hides this
    // toggle for that case (app/qr/[slug]/page.jsx), but this is the real
    // source of truth -- a stale page or a direct request shouldn't be
    // able to set a flag that'll just be silently ignored.
    if (!SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier) || booking.delivery_format === "video_only") {
      return NextResponse.json({ error: "Social cuts aren't available on this tier" }, { status: 400 });
    }
    updates.must_include_social = Boolean(body.mustIncludeSocial);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Scope the update to this booking's own uploads -- eventId (upload_slug)
  // is the only credential a host has, so it must gate which upload rows
  // they're allowed to touch, not just which booking they can view.
  const { data, error } = await supabase
    .from("uploads")
    .update(updates)
    .eq("id", uploadId)
    .eq("booking_id", booking.id)
    .select()
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Photo not found for this event" }, { status: 404 });
  }

  return NextResponse.json({ success: true, mustInclude: data.must_include, mustIncludeSocial: data.must_include_social });
}

// Lets a host free up room against their tier's upload cap (lib/uploadLimits.js)
// without waiting on us -- the alternative was a WhatsApp message asking us to
// do it by hand. Paired with sendUploadCapReachedEmail (lib/email.js), which
// points hosts here the moment they hit the cap.
export async function DELETE(req, { params }) {
  const { eventId, uploadId } = await params;

  const { success } = await checkRateLimit("event-photos", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, status, upload_cap_notified_at")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Deleting a guest's photo is squarely the host's call, not a guest's --
  // same reasoning as the must-include toggle above. See lib/hostToken.js.
  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  // Once processing has started, the photo set is already locked in --
  // analyzing has it in a paid-for Claude batch (see submitAnalysisBatch in
  // scripts/auto-recap.js), editing/delivered have it in a render_state or a
  // finished deliverable that already snapshotted the gallery. Deleting the
  // row at that point wouldn't retroactively pull it from any of those, so
  // it would just make the DB and the actual recap disagree with each other.
  if (["analyzing", "editing", "delivered"].includes(booking.status)) {
    return NextResponse.json(
      { error: "This event's recap has already started processing -- photos can no longer be removed." },
      { status: 400 }
    );
  }

  // DELETE ... RETURNING in one round trip -- scoped to booking_id, same as
  // the PATCH above, so upload_slug can only ever touch this booking's own
  // uploads. storage_key comes back from the same query so there's no
  // separate SELECT needed before it.
  const { data: deleted, error: deleteError } = await supabase
    .from("uploads")
    .delete()
    .eq("id", uploadId)
    .eq("booking_id", booking.id)
    .select("storage_key")
    .maybeSingle();

  if (deleteError || !deleted) {
    return NextResponse.json({ error: "Photo not found for this event" }, { status: 404 });
  }

  // The DB row (the thing that actually frees a slot against the upload cap
  // trigger) is already gone at this point -- an R2 failure here shouldn't
  // undo that or fail the request back to the host. It does mean the object
  // can be orphaned in R2 with no uploads row pointing at it; there's no
  // pre-delivery sweep for that today; see poll-and-recap.js's cleanup pass.
  try {
    await deleteFile(deleted.storage_key);
  } catch (err) {
    console.error(`Failed to delete R2 object ${deleted.storage_key} for booking ${booking.id}:`, err.message);
    captureError(err, { tags: { route: "events.uploads.delete" }, extra: { bookingId: booking.id, key: deleted.storage_key } });
  }

  // A host who deletes photos specifically to make room, then re-fills the
  // event, should hear about it again -- not stay silenced by whatever
  // notified them the first time. See sendUploadCapReachedEmail's own
  // comment in lib/email.js.
  if (booking.upload_cap_notified_at) {
    await supabase.from("bookings").update({ upload_cap_notified_at: null }).eq("id", booking.id);
  }

  return NextResponse.json({ success: true });
}
