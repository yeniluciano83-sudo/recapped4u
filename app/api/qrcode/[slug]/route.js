import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// Generates a QR code PNG pointing to this event's guest upload page.
// Usage: GET /api/qrcode/[slug]  -> returns a PNG image
// The slug is the booking's upload_slug (the same one used in /event/[slug]).
export async function GET(req, { params }) {
  const { slug } = params;

  const { success } = await checkRateLimit("qrcode", req, { requests: 60, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  // Confirm the booking actually exists before generating a code for it
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("upload_slug, host_name")
    .eq("upload_slug", slug)
    .single();

  if (error || !booking) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const uploadUrl = `${process.env.APP_URL}/event/${slug}`;

  try {
    const qrBuffer = await QRCode.toBuffer(uploadUrl, {
      width: 600,
      margin: 2,
      color: {
        dark: "#211F1D",
        light: "#FFFFFF",
      },
    });

    return new NextResponse(qrBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": `inline; filename="recapped-qr-${slug}.png"`,
      },
    });
  } catch (err) {
    console.error("QR generation failed:", err);
    return NextResponse.json({ error: "QR generation failed" }, { status: 500 });
  }
}
