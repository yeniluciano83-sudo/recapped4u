import fs from "fs";
import path from "path";
import sharp from "sharp";
import opentypeModule from "opentype.js/dist/opentype.js";
import { getInviteMood } from "./inviteMoods.js";
import { generateQrPngBuffer, QR_SIZE } from "./qrGenerate.js";

// The bare specifier "opentype.js" resolves differently by environment:
// plain Node ESM (this file run standalone) follows package.json's "main"
// (the CJS UMD build, which has a `default` key), but Turbopack -- and
// most bundlers -- prefer "module" (the real ESM build), which only has
// named exports and NO default at all, so `import opentypeModule from
// "opentype.js"` throws a build-time "export default was not found" error
// under `next dev`/Turbopack even though it runs fine under plain `node`.
// Importing the CJS file by its explicit subpath sidesteps that field
// ambiguity so both environments load the exact same module shape.
const opentype = opentypeModule.default || opentypeModule;

const CARD_W = 1080;
const CARD_H = 1920;

// Text is rendered as real vector outlines (via opentype.js), not SVG
// <text>, and for good reason -- confirmed live, twice:
//   1. An embedded @font-face in the SVG is silently ignored by sharp's
//      renderer (librsvg never implemented @font-face at all).
//   2. Falling back to plain CSS generics ("Georgia"/"sans-serif" etc.)
//      rendered fine on this machine (Windows has those installed) but as
//      pure tofu boxes once deployed -- Vercel's Linux runtime has no
//      fonts registered with fontconfig for ANY family name to resolve to.
// Converting text to paths up front sidesteps font resolution entirely --
// the renderer just draws shapes, so this can't regress again the same
// way. path.join(process.cwd(), ...) rather than __dirname -- the
// documented, traceable pattern for bundling an extra file into a
// Next.js serverless function. Parsed once per process; every invite
// share after the first reuses the same Font object.
//
// opentype.js's own text-shaping path (Font.getPath/getAdvanceWidth) runs
// every string through its GSUB/Bidi feature engine first, and that engine
// doesn't support one of the lookup formats in this font's GSUB table --
// confirmed live, it throws "substitutionType : 62 lookupType: 6 -
// substFormat: 2 is not yet supported" on every single call, not something
// an options flag can turn off (ccmp is applied unconditionally regardless
// of the `features` option). glyphsToPath below bypasses that whole
// pipeline -- charToGlyph is a plain cmap lookup with no shaping -- which
// costs ligatures/kerning this card was never using anyway.
const FONT_PATH = path.join(process.cwd(), "lib", "fonts", "Oswald-Bold.ttf");
let FONT = null;
try {
  FONT = opentype.parse(fs.readFileSync(FONT_PATH));
} catch (err) {
  // No text renders below (see textPath) rather than a 500 on every
  // invite share -- a card with just the background/QR still beats a
  // broken feature end-to-end.
  console.error("Invite card font failed to load:", err.message);
}

// One glyph per character, laid out left-to-right and merged into a single
// Path -- see the FONT loading comment above for why this doesn't go
// through font.getPath/getAdvanceWidth.
function glyphsToPath(str, x, y, fontSize) {
  const scale = fontSize / FONT.unitsPerEm;
  const fullPath = new opentype.Path();
  let cx = x;
  for (const ch of String(str)) {
    const glyph = FONT.charToGlyph(ch);
    fullPath.extend(glyph.getPath(cx, y, fontSize));
    cx += (glyph.advanceWidth || 0) * scale;
  }
  return { path: fullPath, width: cx - x };
}

function measureWidth(str, fontSize) {
  if (!FONT || !str) return 0;
  return glyphsToPath(str, 0, 0, fontSize).width;
}

const round2 = (v) => Math.round(v * 100) / 100;

// A minimal, correct stand-in for opentype.js's own Path.toPathData --
// confirmed live that it emits literal "NaN" into the `d` string for
// certain glyphs (its round-to-N-decimal-places trick concatenates the
// value's fractional part into a string like "6.9e-17e+2" whenever that
// fractional part is itself already in exponential notation, which
// Math.round then can't parse), silently truncating the SVG path -- and
// therefore the rendered text -- at that exact point. Plain Math.round
// has no such failure mode.
function commandsToPathData(commands) {
  let d = "";
  for (const cmd of commands) {
    if (cmd.type === "M") d += `M${round2(cmd.x)} ${round2(cmd.y)}`;
    else if (cmd.type === "L") d += `L${round2(cmd.x)} ${round2(cmd.y)}`;
    else if (cmd.type === "C") d += `C${round2(cmd.x1)} ${round2(cmd.y1)} ${round2(cmd.x2)} ${round2(cmd.y2)} ${round2(cmd.x)} ${round2(cmd.y)}`;
    else if (cmd.type === "Q") d += `Q${round2(cmd.x1)} ${round2(cmd.y1)} ${round2(cmd.x)} ${round2(cmd.y)}`;
    else if (cmd.type === "Z") d += "Z";
  }
  return d;
}

// x/align: "left" (default) or "center" -- opentype has no text-anchor
// equivalent, so a centered line is measured and shifted by hand.
// Returns "" (renders nothing) when FONT never loaded.
function textPath(str, x, y, fontSize, fill, { align = "left", opacity } = {}) {
  if (!FONT || !str) return "";
  const width = align === "center" ? measureWidth(str, fontSize) : 0;
  const drawX = align === "center" ? x - width / 2 : x;
  const d = commandsToPathData(glyphsToPath(str, drawX, y, fontSize).path.commands);
  return `<path d="${d}" fill="${fill}"${opacity != null ? ` opacity="${opacity}"` : ""} />`;
}

// SVG paths don't auto-wrap -- greedy word-wrap into at most maxLines using
// the font's own advance width (not a character-count guess), ellipsizing
// whatever's left over on the last line. Good enough for a decorative
// card (a host's own event-type/venue text, not a document); a single
// word wider than maxWidth on its own is just left to overflow slightly
// rather than being hyphenated.
function wrapText(str, fontSize, maxWidth, maxLines) {
  const words = String(str || "").trim().split(/\s+/).filter(Boolean);
  if (!FONT || !words.length) return [];
  const widthOf = (s) => measureWidth(s, fontSize);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const consumedWords = lines.join(" ").split(/\s+/).length;
    if (consumedWords < words.length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && widthOf(`${last}…`) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
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
  const textMaxWidth = innerRight - innerX;

  const headlineLines = wrapText(eventType || "You're Invited", 72, textMaxWidth, 2);
  const dateTimeLine = [dateLabel, timeLabel].filter(Boolean).join("   ·   ");
  const venueLines = venue ? wrapText(venue, 32, textMaxWidth, 2) : [];

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
  ${textPath("YOU'RE INVITED", innerX, eyebrowY, 28, mood.accent)}
  ${headlineLines.map((line, i) => textPath(line, innerX, headlineStartY + i * headlineLineHeight, 72, mood.text)).join("\n  ")}
  ${textPath(`Hosted by ${hostName || "your host"}`, innerX, hostedByY, 34, mood.muted)}
  <line x1="${innerX}" y1="${dividerY}" x2="${innerRight}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.35" stroke-width="2" />
  ${textPath(dateTimeLine, innerX, dateY, 40, mood.text)}
  ${venueLines.map((line, i) => textPath(line, innerX, venueY + i * 42, 32, mood.muted)).join("\n  ")}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.4" />
  ${textPath("Scan to add your photos — no app needed", CARD_W / 2, footerY, 28, mood.muted, { align: "center" })}
  ${textPath(uploadUrl, CARD_W / 2, urlY, 22, mood.muted, { align: "center", opacity: 0.75 })}
</svg>`;

  if (process.env.DEBUG_INVITE_SVG) fs.writeFileSync(process.env.DEBUG_INVITE_SVG, svg);

  const [baseCard, qrBuffer] = await Promise.all([
    sharp(Buffer.from(svg)).png().toBuffer(),
    generateQrPngBuffer(uploadUrl),
  ]);

  return sharp(baseCard)
    .composite([{ input: qrBuffer, left: Math.round(qrFrameX + 40), top: Math.round(qrFrameY + 40) }])
    .png()
    .toBuffer();
}
