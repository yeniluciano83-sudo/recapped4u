import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Protected by middleware.js (dashboard_auth cookie). The list endpoint
// (/api/admin/custom-inquiries) intentionally doesn't include each
// inquiry's message thread -- fetched separately here, only when a host
// is actually selected in the dashboard.
export async function GET(req, { params }) {
  const { id } = params;

  const { data: inquiry, error } = await supabase.from("custom_inquiries").select("*").eq("id", id).single();
  if (error || !inquiry) {
    return NextResponse.json({ error: "Inquiry not found" }, { status: 404 });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("custom_inquiry_messages")
    .select("*")
    .eq("inquiry_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  return NextResponse.json({ inquiry, messages });
}
