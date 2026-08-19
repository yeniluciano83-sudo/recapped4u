import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadFile, buildStorageKey } from "@/lib/storage";

export async function POST(req, { params }) {
  const { eventId } = params;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, uploads_closed_at, status")
    .eq("upload_slug", eventId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "This event has been cancelled." }, { status: 400 });
  }

  if (booking.status === "pending_confirmation") {
    return NextResponse.json({ error: "This event hasn't been activated yet." }, { status: 400 });
  }

  if (booking.uploads_closed_at) {
    return NextResponse.json(
      { error: "The host has closed uploads for this event -- the recap is already being put together." },
      { status: 400 }
    );
  }

  try {
    const formData = await req.formData();
    const uploaderName = formData.get("uploaderName") || "Guest";
    const files = formData.getAll("files");

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = buildStorageKey({ bookingId: booking.id, kind: "raw", filename: file.name });
      await uploadFile(key, buffer, file.type);

      const fileType = file.type.startsWith("video") ? "video" : "photo";

      const { data: uploadRow, error: insertError } = await supabase
        .from("uploads")
        .insert({
          booking_id: booking.id,
          uploader_name: uploaderName,
          storage_key: key,
          file_type: fileType,
        })
        .select()
        .single();

      if (!insertError) results.push(uploadRow);
    }

    // First guest upload moves the event from "booked"/"collecting" if not already there
    await supabase
      .from("bookings")
      .update({ status: "collecting" })
      .eq("id", booking.id)
      .neq("status", "editing")
      .neq("status", "delivered")
      .neq("status", "cancelled");

    return NextResponse.json({ uploaded: results.length });
  } catch (err) {
    console.error(`Upload failed for booking ${booking.id}:`, err);
    return NextResponse.json({ error: `Upload failed: ${err.message}` }, { status: 500 });
  }
}
