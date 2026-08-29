import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { captureError } from "@/lib/sentry";

const VALID_STATUSES = ["booked", "collecting", "analyzing", "editing", "delivered"];

export async function PATCH(req, { params }) {
  const { id } = params;

  try {
    const { status } = await req.json();

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, booking: data });
  } catch (err) {
    console.error("Status update failed:", err);
    captureError(err, { tags: { route: "bookings.status-update" }, extra: { bookingId: id } });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
