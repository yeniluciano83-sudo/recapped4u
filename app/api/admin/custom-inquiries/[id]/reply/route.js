import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendCustomInquiryReply } from "@/lib/email";

// Protected by middleware.js (dashboard_auth cookie). For replying without
// committing to a price yet -- a clarifying question, or telling a host a
// request isn't doable. Separate from the quote route so declining
// something never requires picking a tier/price first.
export async function POST(req, { params }) {
  const { id } = params;

  try {
    const { message, decline } = await req.json();

    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Message can't be empty" }, { status: 400 });
    }

    const { data: inquiry, error } = await supabase
      .from("custom_inquiries")
      .select("host_name, email, event_type, status")
      .eq("id", id)
      .single();

    if (error || !inquiry) {
      return NextResponse.json({ error: "Inquiry not found" }, { status: 404 });
    }

    if (decline) {
      await supabase
        .from("custom_inquiries")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("id", id);
    }

    await sendCustomInquiryReply({
      to: inquiry.email,
      hostName: inquiry.host_name,
      eventType: inquiry.event_type,
      message: message.trim(),
      declined: !!decline,
    });

    const { data: updated } = await supabase.from("custom_inquiries").select("*").eq("id", id).single();

    return NextResponse.json({ success: true, inquiry: updated });
  } catch (err) {
    console.error("Failed to send inquiry reply:", err);
    return NextResponse.json({ error: "Failed to send reply" }, { status: 500 });
  }
}
