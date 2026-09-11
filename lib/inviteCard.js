import sharp from "sharp";
import { getInviteMood } from "./inviteMoods.js";
import { generateQrPngBuffer, QR_SIZE } from "./qrGenerate.js";

const CARD_W = 1080;
const CARD_H = 1920;

// No custom font here, on purpose -- confirmed live that sharp's SVG
// renderer (librsvg) doesn't honor an embedded @font-face at all (it just
// silently falls through to its own default), the same "font rendering
// inside sharp/librsvg isn't guaranteed consistent" limitation the QR
// logo's own comment already called out, so lib/fonts/Oswald-Bold.ttf
// (bundled for ffmpeg's drawtext, a completely different renderer) can't
// be reused here. Plain CSS generic keywords ("serif"/"sans-serif") are
// what's actually reliable: fontconfig maps them to whatever real font
// exists in the environment, and the card reads perfectly fine either way
// -- this is decoration, not a document.
const HEADLINE_FONT = "Georgia, 'Times New Roman', serif";
const BODY_FONT = "Verdana, Arial, sans-serif";

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

// SVG <text> doesn't auto-wrap -- greedy word-wrap into at most maxLines,
// ellipsizing whatever's left over on the last line. Good enough for a
// decorative card (a host's own event-type/venue text, not a document);
// not meant to be exact.
function wrapText(str, maxCharsPerLine, maxLines) {
  const words = String(str || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const consumed = lines.slice(0, -1).join(" ").length + (lines.length > 1 ? 1 : 0);
    const stillLeft = words.join(" ").length > consumed + last.length;
    if (stillLeft) lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}…` : last;
  }
  return lines;
}

// A shareable "you're invited" card: event details + the same QR code from
// the host's share page, generated as one image a host can post to a
// story/status or send directly in a text/WhatsApp message -- the site's
// existing print-only poster (app/qr/[slug]/page.jsx's .print-card) covers
// the "tape it up at the venue" case; this covers "forward it to someone
// who isn't there in person." Themed per getInviteMood(eventType) -- see
// lib/inviteMoods.js for the palette-per-event-type mapping and its
// "generic" fallback.
export async function buildInviteCard({ hostName, eventType, eventDate, eventTime, venue, uploadUrl, dateLabel, timeLabel }) {
  const mood = getInviteMood(eventType);

  const panelX = 90, panelY = 260, panelW = CARD_W - panelX * 2, panelH = 1500;
  const innerX = panelX + 90;
  const innerRight = panelX + panelW - 90;

  const headlineLines = wrapText(eventType || "You're Invited", 20, 2);
  const dateTimeLine = [dateLabel, timeLabel].filter(Boolean).join("  ·  ");
  const venueLines = venue ? wrapText(venue, 34, 2) : [];

  let y = panelY + 130;
  const eyebrowY = y;
  y += 90;
  const headlineStartY = y;
  const headlineLineHeight = 84;
  y += headlineLines.length * headlineLineHeight;
  y += 20;
  const hostedByY = y;
  y += 60;
  const dividerY = y;
  y += 60;
  const dateY = y;
  y += 56;
  let venueY = null;
  if (venueLines.length) {
    venueY = y;
    y += venueLines.length * 42 + 20;
  }
  y += 30;
  const qrFrameSize = QR_SIZE + 80;
  const qrFrameX = panelX + (panelW - qrFrameSize) / 2;
  const qrFrameY = y;
  y += qrFrameSize + 44;
  const footerY = y;
  const urlY = footerY + 40;

  const svg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="blob-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="70" />
    </filter>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${mood.bg}" />
  <circle cx="140" cy="160" r="260" fill="${mood.blobs[0]}" opacity="0.32" filter="url(#blob-blur)" />
  <circle cx="${CARD_W - 120}" cy="${CARD_H - 200}" r="300" fill="${mood.blobs[1]}" opacity="0.30" filter="url(#blob-blur)" />
  <rect x="${panelX + 10}" y="${panelY + 14}" width="${panelW}" height="${panelH}" rx="48" fill="#000000" opacity="0.08" />
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="48" fill="${mood.card}" />
  <text x="${innerX}" y="${eyebrowY}" font-family="${BODY_FONT}" font-size="30" letter-spacing="6" fill="${mood.accent}">YOU'RE INVITED</text>
  ${headlineLines.map((line, i) => `<text x="${innerX}" y="${headlineStartY + i * headlineLineHeight}" font-family="${HEADLINE_FONT}" font-size="72" fill="${mood.text}">${escapeXml(line)}</text>`).join("\n  ")}
  <text x="${innerX}" y="${hostedByY}" font-family="${BODY_FONT}" font-size="34" fill="${mood.muted}">Hosted by ${escapeXml(hostName || "your host")}</text>
  <line x1="${innerX}" y1="${dividerY}" x2="${innerRight}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.35" stroke-width="2" />
  <text x="${innerX}" y="${dateY}" font-family="${HEADLINE_FONT}" font-size="40" fill="${mood.text}">${escapeXml(dateTimeLine)}</text>
  ${venueLines.map((line, i) => `<text x="${innerX}" y="${venueY + i * 42}" font-family="${BODY_FONT}" font-size="32" fill="${mood.muted}">${escapeXml(line)}</text>`).join("\n  ")}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.4" />
  <text x="${CARD_W / 2}" y="${footerY}" text-anchor="middle" font-family="${BODY_FONT}" font-size="30" fill="${mood.muted}">Scan to add your photos — no app needed</text>
  <text x="${CARD_W / 2}" y="${urlY}" text-anchor="middle" font-family="${BODY_FONT}" font-size="24" fill="${mood.muted}" opacity="0.75">${escapeXml(uploadUrl)}</text>
</svg>`;

  const [baseCard, qrBuffer] = await Promise.all([
    sharp(Buffer.from(svg)).png().toBuffer(),
    generateQrPngBuffer(uploadUrl),
  ]);

  return sharp(baseCard)
    .composite([{ input: qrBuffer, left: Math.round(qrFrameX + 40), top: Math.round(qrFrameY + 40) }])
    .png()
    .toBuffer();
}
