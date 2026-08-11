import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// eventId here is the booking's upload_slug (the short code in the QR/link URL)
export async function GET(req, { params }) {
  const { eventId } = params;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, event_date, upload_slug")
    .eq("upload_slug", eventId)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { count } = await supabase
    .from("uploads")
    .select("*", { count: "exact", head: true })
    .eq("booking_id", booking.id);

  return NextResponse.json({ event: booking, uploadCount: count || 0 });
}
