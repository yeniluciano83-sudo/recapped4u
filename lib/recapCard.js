import sharp from "sharp";
import { getInviteMood, NON_ITALIC_MOODS } from "./inviteMoods.js";
import { generateQrPngBuffer, QR_SIZE } from "./qrGenerate.js";
import { textPath, wrapText } from "./cardText.js";

// The host's "your recap is ready" share card -- a phone-story shape
// (1080x1920, same as the guest invite, so it drops straight into a
// Story/text the same way) they can post or send once their video's done.
// Deliberately NOT themed illustration the way lib/inviteCard.js is: this
// is a reveal, so the whole point is showing the actual finished result --
// a real gallery photo from the event -- full-bleed, with just enough of a
// bottom scrim to keep the event name and QR legible over whatever that
// photo happens to look like.
const CARD_W = 1080;
const CARD_H = 1920;

// photoBuffer: raw bytes of whichever image the caller resolved for this
// booking -- normally the first gallery photo, occasionally a video poster
// frame as a last-resort fallback (see the caller,
// app/api/recap-card/[bookingId]/route.js, for why a gallery photo is
// preferred: the poster frame is itself a screenshot of the video's own
// intro title card, which already has "<host>'s <event type>" burned into
// it -- confirmed live that using it here doubled that same text in two
// different fonts, badly misaligned).
export async function buildRecapCard({ hostName, eventType, galleryUrl, photoBuffer }) {
  const mood = getInviteMood(eventType);
  const italic = !NON_ITALIC_MOODS.has(mood.key);
  const pad = 110;
  const textMaxWidth = CARD_W - pad * 2;

  const eventName = hostName ? `${hostName}'s ${eventType || "Event"}` : (eventType || "Your Recap");
  const headlineLines = wrapText(eventName, 56, textMaxWidth, 2);

  const EYEBROW_SIZE = 26;
  const HEADLINE_SIZE = 56;
  const HEADLINE_LINE_HEIGHT = 64;
  const TAGLINE_SIZE = 29;
  const FOOTER1_SIZE = 28;
  const FOOTER2_SIZE = 23;
  const qrFrameSize = QR_SIZE + 70;
  const qrFrameX = (CARD_W - qrFrameSize) / 2;

  const footerLine1 = "Scan or tap to watch & download";
  const tagline = "Every photo, one recap video, ready to relive";

  // Bottom-anchored stack, built upward from a fixed bottom margin --
  // unlike the invite (a block vertically centered over a blank card),
  // this needs to sit low, over the darkest part of the scrim below,
  // regardless of exactly how tall the headline ends up being.
  let y = CARD_H - 90;
  const footer2Y = y; y -= 34;
  const footer1Y = y; y -= qrFrameSize + 40;
  const qrFrameY = y; y -= 44;
  const taglineY = y; y -= 46;
  const headlineBottomY = y;
  const headlineStartY = headlineBottomY - (headlineLines.length - 1) * HEADLINE_LINE_HEIGHT;
  const eyebrowY = headlineStartY - 52;

  // A bottom-to-top gradient, not a flat translucent panel -- a flat panel
  // would draw a visible hard edge across an arbitrary real photo, where
  // the invite's own scrim never had to worry about that (its background
  // is a flat illustrated tone, not a photo with its own unpredictable
  // brightness/color). Starts well above the eyebrow so there's real ramp-
  // up room -- confirmed live that starting it right at the eyebrow left
  // that line sitting almost directly on the raw photo with barely any
  // darkening yet.
  const scrimTop = Math.max(0, eyebrowY - 220);
  const scrimSvg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0" />
        <stop offset="18%" stop-color="#000000" stop-opacity="0.55" />
        <stop offset="50%" stop-color="#000000" stop-opacity="0.78" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.94" />
      </linearGradient>
    </defs>
    <rect x="0" y="${scrimTop}" width="${CARD_W}" height="${CARD_H - scrimTop}" fill="url(#scrim)" />`;

  // A thin dark outline behind every line (see textPath's own comment on
  // `stroke`) -- the gradient scrim alone still isn't reliable insurance
  // against every possible photo, so text legibility can't depend on the
  // scrim being strong enough at that exact pixel. Widths stay small on
  // purpose (roughly 3% of each line's own font size) -- confirmed live
  // that anything heavier reads as a bold black blob swallowing the white
  // fill entirely, rather than a thin edge around it.
  const outline = (fontSize) => ({ stroke: "#000000", strokeWidth: Math.max(1, Math.round(fontSize * 0.035)) });

  // White/near-white for the headline and footer (has to read over any
  // photo, not just this mood's own cardstock tone the way the invite's
  // mood.text does) -- mood.accent is kept for the one line of real color,
  // same as the invite's own eyebrow/tagline treatment.
  const overlaySvg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${scrimSvg}
  ${textPath("YOUR RECAP IS READY", CARD_W / 2, eyebrowY, EYEBROW_SIZE, mood.accent, { align: "center", italic, ...outline(EYEBROW_SIZE) })}
  ${headlineLines.map((line, i) => textPath(line, CARD_W / 2, headlineStartY + i * HEADLINE_LINE_HEIGHT, HEADLINE_SIZE, "#FFFFFF", { align: "center", italic, ...outline(HEADLINE_SIZE) })).join("\n  ")}
  ${textPath(tagline, CARD_W / 2, taglineY, TAGLINE_SIZE, "#F0EDE7", { align: "center", opacity: 0.95, italic, ...outline(TAGLINE_SIZE) })}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.6" />
  ${textPath(footerLine1, CARD_W / 2, footer1Y, FOOTER1_SIZE, "#FFFFFF", { align: "center", opacity: 0.95, italic, ...outline(FOOTER1_SIZE) })}
  ${textPath("No app needed", CARD_W / 2, footer2Y, FOOTER2_SIZE, "#F0EDE7", { align: "center", opacity: 0.85, italic, ...outline(FOOTER2_SIZE) })}
</svg>`;

  const [backgroundBuffer, overlayBuffer, qrBuffer] = await Promise.all([
    // fit: "cover" -- a guest's photo is whatever aspect ratio their phone
    // shot it in, never this card's own 9:16, so this crops rather than
    // distorting it.
    sharp(photoBuffer).resize(CARD_W, CARD_H, { fit: "cover" }).sharpen({ sigma: 1.0 }).png().toBuffer(),
    sharp(Buffer.from(overlaySvg)).png().toBuffer(),
    generateQrPngBuffer(galleryUrl),
  ]);

  return sharp(backgroundBuffer)
    .composite([
      { input: overlayBuffer },
      { input: qrBuffer, left: Math.round(qrFrameX + 35), top: Math.round(qrFrameY + 35) },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}
