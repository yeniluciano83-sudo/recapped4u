import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendCustomInquiry, sendCustomInquiryReceived } from "@/lib/email";

// Custom packages have no fixed price up front -- this saves the inquiry
// so it can be quoted and tracked through to payment (see
// /api/admin/custom-inquiries and /api/custom-quote/[id]), rather than
// existing only as an email that goes stale the moment it's archived.
export async function POST(req) {
  try {
    const body = await req.json();
    const { hostName, email, eventType, eventDate, guestCount, style, notes } = body;

    if (!hostName || !email || !eventType || !eventDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data: inquiry, error } = await supabase
      .from("custom_inquiries")
      .insert({
        host_name: hostName,
        email,
        event_type: eventType,
        event_date: eventDate,
        guest_count: guestCount || null,
        style: style || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    await sendCustomInquiry({ hostName, email, eventType, eventDate, guestCount, style, notes });
    try {
      await sendCustomInquiryReceived({ to: email, hostName, eventType });
    } catch (err) {
      // The business-facing notification above already landed -- a failed
      // host ack shouldn't fail the whole request.
      console.error("Custom inquiry received-email failed:", err.message);
    }

    return NextResponse.json({ success: true, inquiryId: inquiry.id });
  } catch (err) {
    console.error("Custom inquiry failed:", err);
    return NextResponse.json({ error: "Inquiry failed" }, { status: 500 });
  }
}
