import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Staff-only, covered by middleware.js's /api/bookings/:path* matcher --
// same dashboard cookie gate as the rest of the bookings API.
export async function GET(req, { params }) {
  const { id } = params;

  const { data, error } = await supabase
    .from("upload_analysis_failures")
    .select("id, storage_key, error_message, created_at")
    .eq("booking_id", id)
    .order("created_at", { ascending: false });

  // PGRST204/42P01 here means migration 024 hasn't been applied yet --
  // report no failures rather than erroring, same graceful-degradation
  // pattern as elsewhere in this codebase.
  if (error) {
    console.error(`Failed to fetch analysis failures for booking ${id}:`, error.message);
    return NextResponse.json({ failures: [] });
  }

  return NextResponse.json({ failures: data || [] });
}
