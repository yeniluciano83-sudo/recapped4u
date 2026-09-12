import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidHostToken, hostTokenFromRequest } from "@/lib/hostToken";
import { sendGuestInviteEmail } from "@/lib/email";
import { captureError } from "@/lib/sentry";

// Same simple "good enough" format check used nowhere else in this app yet
// (host/guest emails elsewhere rely on the browser's own <input type="email">
// plus Resend/Stripe rejecting anything truly malformed) -- worth an actual
// check here since a typo in a hand-typed guest address would otherwise just
// silently bounce with no feedback to the host at all.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A host blasting an unbounded guest list in one request is exactly the
// shape of a spam vector this route can be used for -- caps a single send,
// on top of the request-level rate limit below.
const MAX_RECIPIENTS = 25;

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  try { return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

function formatTimeLabel(timeStr) {
  if (!timeStr) return "";
  try { return new Date(`2000-01-01T${timeStr}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  catch { return timeStr; }
}

// Host-only: emails the same digital invite image every other share path
// uses (see app/api/invite/[slug]/route.js) directly to a list of guest
// addresses, with the image actually embedded in the message -- see
// sendGuestInviteEmail's own comment in lib/email.js for why this exists
// (the native share sheet's Mail/Gmail targets often drop the image file
// and leave a guest with nothing but a bare link).
export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("send-invite", req, { requests: 5, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, event_time, venue")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!isValidHostToken(booking.id, hostTokenFromRequest(req))) {
    return NextResponse.json({ error: "This link isn't valid for managing this event." }, { status: 403 });
  }

  const { emails } = await req.json().catch(() => ({}));
  const list = Array.isArray(emails) ? emails : [];
  // Deduped -- pasting the same address twice (or a guest already on the
  // list) shouldn't turn into a second email landing in the same inbox.
  const trimmed = [...new Set(list.map((e) => String(e || "").trim()).filter(Boolean))];

  if (trimmed.length === 0) {
    return NextResponse.json({ error: "Enter at least one guest email address." }, { status: 400 });
  }
  if (trimmed.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `You can send to up to ${MAX_RECIPIENTS} guests at a time.` }, { status: 400 });
  }
  const invalid = trimmed.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `These don't look like valid email addresses: ${invalid.join(", ")}` }, { status: 400 });
  }

  const eventName = `${booking.host_name}'s ${booking.event_type || "Event"}`;
  const dateTimeLine = [formatDateLabel(booking.event_date), formatTimeLabel(booking.event_time)].filter(Boolean).join(" · ");
  const uploadUrl = `${process.env.APP_URL}/event/${eventId}`;
  const inviteImageUrl = `${process.env.APP_URL}/api/invite/${eventId}`;

  // Best-effort per address, same posture as every other multi-recipient
  // send in this app (e.g. scripts/auto-recap.js's failure alerts) -- one
  // bad address (a typo Resend rejects) shouldn't sink the rest of a guest
  // list that were otherwise all fine.
  const results = await Promise.allSettled(
    trimmed.map((to) => sendGuestInviteEmail({ to, eventName, dateTimeLine, venue: booking.venue, uploadUrl, inviteImageUrl }))
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    captureError(new Error("send-invite: one or more guest emails failed"), {
      tags: { route: "send-invite" },
      extra: { eventId, failedCount: failed.length, total: trimmed.length, reasons: failed.map((r) => r.reason?.message) },
    });
  }

  if (failed.length === trimmed.length) {
    return NextResponse.json({ error: "Failed to send the invite. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ sent: trimmed.length - failed.length, failed: failed.length });
}
