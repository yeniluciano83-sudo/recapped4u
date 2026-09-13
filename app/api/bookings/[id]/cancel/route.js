import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { cancelBooking } from "@/lib/cancelBooking";

// Staff-only cancel action, reached from the dashboard (app/dashboard
// /page.jsx) -- gated by the dashboard_auth cookie via proxy.js's own
// matcher (/api/bookings/:path*), not a host token, since this route
// stands in for the host's own cancel link when staff need to cancel a
// booking on someone's behalf (a phone call, a support request, etc.).
// Same underlying rules either way -- see cancelBooking's own comment in
// lib/cancelBooking.js for the full reasoning (once processing has
// started it's too late; refund eligibility is the same 24-hour rule).
export async function POST(req, { params }) {
  const { id } = await params;

  const { data: booking, error } = await supabase.from("bookings").select("*").eq("id", id).single();
  if (error || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { body, status } = await cancelBooking(booking);
  return NextResponse.json(body, { status });
}
