import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Protected by middleware.js (dashboard_auth cookie) -- same gate as
// /api/bookings.
export async function GET() {
  const { data, error } = await supabase
    .from("custom_inquiries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inquiries: data });
}
