import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildInviteCard } from "@/lib/inviteCard.js";
import { captureError } from "@/lib/sentry";

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

// Generates a shareable "you're invited" image for this event -- event
// details, and the same QR/upload link from app/api/qrcode/[slug] baked
// into one picture a host can post to a story or send in a text, rather
// than only ever printing a poster. Public and unauthenticated on purpose,
// same reasoning as the QR route: the slug is on the QR poster every guest
// scans, and this route only ever hands back the same upload link.
// Usage: GET /api/invite/[slug] -> returns a JPEG image
export async function GET(req, { params }) {
  const { slug } = await params;

  const { success } = await checkRateLimit("invite-card", req, { requests: 30, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("upload_slug, host_name, event_type, event_date, event_time, venue")
    .eq("upload_slug", slug)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const uploadUrl = `${process.env.APP_URL}/event/${slug}`;

  try {
    const cardBuffer = await buildInviteCard({
      hostName: booking.host_name,
      eventType: booking.event_type,
      venue: booking.venue,
      uploadUrl,
      dateLabel: formatDateLabel(booking.event_date),
      timeLabel: formatTimeLabel(booking.event_time),
    });

    return new NextResponse(cardBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="recapped-invite-${slug}.jpg"`,
      },
    });
  } catch (err) {
    console.error("Invite card generation failed:", err);
    captureError(err, { tags: { route: "invite" }, extra: { slug } });
    return NextResponse.json({ error: "Invite generation failed" }, { status: 500 });
  }
}
