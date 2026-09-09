import { NextResponse } from "next/server";
import QRCode from "qrcode";
import sharp from "sharp";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";
import { captureError } from "@/lib/sentry";

const QR_SIZE = 600;

// A center logo only stays reliably scannable at high error-correction
// ("H" tolerates roughly 30% of the code being damaged or covered -- enough
// to punch a logo-sized hole in the middle without breaking a scan). Kept
// deliberately simple -- a plain rounded square in the brand's accent color,
// no text or icon glyph -- since font rendering inside sharp/librsvg isn't
// guaranteed consistent across environments; a missing font falls back
// silently to something else, while a flat shape renders identically
// everywhere this runs. This is printed and scanned at real events, so
// reliability wins over cleverness here.
async function addCenterLogo(qrBuffer) {
  const logoSize = Math.round(QR_SIZE * 0.16);
  const quietZone = Math.round(logoSize * 1.35);
  const logoSvg = `
    <svg width="${quietZone}" height="${quietZone}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${quietZone}" height="${quietZone}" rx="${Math.round(quietZone * 0.22)}" fill="#FFFFFF"/>
      <rect x="${Math.round((quietZone - logoSize) / 2)}" y="${Math.round((quietZone - logoSize) / 2)}" width="${logoSize}" height="${logoSize}" rx="${Math.round(logoSize * 0.24)}" fill="#C97A3D"/>
    </svg>
  `;
  const logoBuffer = await sharp(Buffer.from(logoSvg)).png().toBuffer();
  return sharp(qrBuffer).composite([{ input: logoBuffer, gravity: "center" }]).png().toBuffer();
}

// Generates a QR code PNG pointing to this event's guest upload page.
// Usage: GET /api/qrcode/[slug]  -> returns a PNG image
// The slug is the booking's upload_slug (the same one used in /event/[slug]).
export async function GET(req, { params }) {
  const { slug } = await params;

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
    const qrRaw = await QRCode.toBuffer(uploadUrl, {
      width: QR_SIZE,
      margin: 2,
      errorCorrectionLevel: "H",
      color: {
        dark: "#211F1D",
        light: "#FFFFFF",
      },
    });
    const qrBuffer = await addCenterLogo(qrRaw);

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
    captureError(err, { tags: { route: "qrcode" }, extra: { slug } });
    return NextResponse.json({ error: "QR generation failed" }, { status: 500 });
  }
}
