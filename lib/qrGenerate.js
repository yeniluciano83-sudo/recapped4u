import QRCode from "qrcode";
import sharp from "sharp";

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

// Shared by app/api/qrcode/[slug]/route.js and lib/inviteCard.js -- both
// need the exact same code (same size, same error correction, same logo),
// pointing at the same upload URL, so this is the one place that generates
// it rather than two copies that could quietly drift.
export async function generateQrPngBuffer(uploadUrl) {
  const qrRaw = await QRCode.toBuffer(uploadUrl, {
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#211F1D", light: "#FFFFFF" },
  });
  return addCenterLogo(qrRaw);
}

export { QR_SIZE };
