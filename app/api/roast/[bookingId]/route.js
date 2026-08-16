import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { bookingId } = params;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, host_name, event_type, style")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { data: roastScript, error: scriptError } = await supabase
    .from("roast_scripts")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (scriptError || !roastScript) {
    return NextResponse.json({ error: "No Roast Reel script found for this booking" }, { status: 404 });
  }

  const lines = await Promise.all(
    roastScript.script.map(async (entry) => ({
      ...entry,
      photo_url: await getSignedDownloadUrl(entry.storage_key, 3600),
    }))
  );

  return NextResponse.json({
    booking,
    status: roastScript.status,
    lines,
  });
}

export async function PATCH(req, { params }) {
  const { bookingId } = params;

  try {
    const { lines } = await req.json();

    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "Missing or invalid lines" }, { status: 400 });
    }

    const { data: roastScript, error: fetchError } = await supabase
      .from("roast_scripts")
      .select("id")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError || !roastScript) {
      return NextResponse.json({ error: "No Roast Reel script found for this booking" }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("roast_scripts")
      .update({ script: lines, status: "approved", approved_at: new Date().toISOString() })
      .eq("id", roastScript.id);

    if (updateError) throw updateError;

    // Approval clears the way for final render, but the actual re-assembly
    // with the approved lines burned in isn't wired up yet -- this just
    // moves the booking out of the approval gate.
    await supabase.from("bookings").update({ status: "editing" }).eq("id", bookingId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Roast script approval failed:", err);
    return NextResponse.json({ error: "Approval failed" }, { status: 500 });
  }
}
