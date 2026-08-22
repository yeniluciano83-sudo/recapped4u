import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// Lets a host signal "guests are done uploading" ahead of their tier's
// upload deadline. Doesn't run the pipeline directly (that needs
// ffmpeg/sharp and can take minutes -- not a fit for a serverless
// request) -- it just flags the booking, and the scheduler picks it up
// and processes it on its next run instead of waiting for the deadline.
export async function POST(req, { params }) {
  const { eventId } = params;

  const { success } = await checkRateLimit("event-action", req, { requests: 10, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, status, uploads_closed_at")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (booking.status !== "collecting") {
    return NextResponse.json(
      { error: "This event isn't currently collecting uploads, so there's nothing to close." },
      { status: 400 }
    );
  }

  if (booking.uploads_closed_at) {
    return NextResponse.json({ success: true, uploadsClosedAt: booking.uploads_closed_at, alreadyClosed: true });
  }

  const uploadsClosedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("bookings")
    .update({ uploads_closed_at: uploadsClosedAt })
    .eq("id", booking.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to close uploads" }, { status: 500 });
  }

  return NextResponse.json({ success: true, uploadsClosedAt });
}
