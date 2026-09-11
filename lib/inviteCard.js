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

// Per-mood corner artwork -- line-art motifs that actually reference the
// occasion instead of generic dots, drawn centered on their own origin and
// growing up-and-left from it (see placement below, where the bottom-left
// copy is just the same markup rotated 180 degrees around its own origin
// rather than a second hand-drawn variant). Colors come in as params
// (accent, and a secondary pulled from the mood's own blob palette) rather
// than being baked in, so this stays a "recolor of one structure" like
// every other themed element on this card.
const MOTIFS = {
  // A small floral sprig -- stem plus three petal/leaf ellipses.
  romantic: (accent, secondary) => `
    <path d="M0 0 Q 14 -30 0 -62" stroke="${accent}" stroke-width="2" fill="none" opacity="0.55" />
    <ellipse cx="-11" cy="-20" rx="8" ry="15" fill="${secondary}" opacity="0.4" transform="rotate(-32 -11 -20)" />
    <ellipse cx="12" cy="-35" rx="8" ry="15" fill="${accent}" opacity="0.35" transform="rotate(30 12 -35)" />
    <ellipse cx="-8" cy="-52" rx="6" ry="12" fill="${secondary}" opacity="0.32" transform="rotate(-18 -8 -52)" />
  `,
  // Two balloons on strings plus a couple of scattered confetti squares.
  festive: (accent, secondary) => `
    <line x1="-18" y1="4" x2="-22" y2="42" stroke="${secondary}" stroke-width="1.5" opacity="0.45" />
    <ellipse cx="-18" cy="-16" rx="15" ry="19" fill="${secondary}" opacity="0.45" />
    <line x1="10" y1="10" x2="14" y2="46" stroke="${accent}" stroke-width="1.5" opacity="0.45" />
    <ellipse cx="10" cy="-8" rx="13" ry="17" fill="${accent}" opacity="0.4" />
    <rect x="-40" y="-6" width="7" height="7" rx="1.5" fill="${accent}" opacity="0.35" transform="rotate(18 -40 -6)" />
    <rect x="26" y="-30" width="6" height="6" rx="1.5" fill="${secondary}" opacity="0.35" transform="rotate(-24 26 -30)" />
  `,
  // A laurel branch -- leaves stepping up and outward along an arc.
  professional: (accent) => `
    <ellipse cx="14" cy="-4" rx="7" ry="12" fill="${accent}" opacity="0.34" transform="rotate(24 14 -4)" />
    <ellipse cx="29" cy="-15" rx="7" ry="12" fill="${accent}" opacity="0.3" transform="rotate(40 29 -15)" />
    <ellipse cx="43" cy="-32" rx="6" ry="11" fill="${accent}" opacity="0.26" transform="rotate(56 43 -32)" />
    <ellipse cx="54" cy="-52" rx="6" ry="10" fill="${accent}" opacity="0.22" transform="rotate(68 54 -52)" />
  `,
  // A plainer two-leaf sprig -- same idea as romantic's, quieter.
  warm: (accent, secondary) => `
    <path d="M0 0 Q 8 -22 0 -46" stroke="${secondary}" stroke-width="2" fill="none" opacity="0.5" />
    <ellipse cx="-9" cy="-16" rx="8" ry="14" fill="${secondary}" opacity="0.36" transform="rotate(-28 -9 -16)" />
    <ellipse cx="9" cy="-30" rx="8" ry="14" fill="${accent}" opacity="0.3" transform="rotate(28 9 -30)" />
  `,
  // Two sparkles and a dot -- the site's own "Sparkles" accent (see the
  // processing-state icon on app/event/[eventId]/page.jsx) reused here for
  // anything without a stronger motif of its own.
  generic: (accent) => `
    <path d="M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z" fill="${accent}" opacity="0.38" />
    <path d="M30 -34 L32 -28 L38 -26 L32 -24 L30 -18 L28 -24 L22 -26 L28 -28 Z" fill="${accent}" opacity="0.3" />
    <circle cx="14" cy="-46" r="3" fill="${accent}" opacity="0.24" />
  `,
  // A 5-point star outline plus a small holly-style sprig (two leaves, three
  // berries) -- generic enough for "the holidays" broadly rather than one
  // specific holiday's own symbol.
  holiday: (accent, secondary) => `
    <path d="M8 -50 L14 -34 L31 -33 L18 -22 L22 -6 L8 -15 L-6 -6 L-2 -22 L-15 -33 L2 -34 Z"
      fill="none" stroke="${accent}" stroke-width="2" opacity="0.5" />
    <ellipse cx="-14" cy="6" rx="7" ry="13" fill="${secondary}" opacity="0.4" transform="rotate(-30 -14 6)" />
    <ellipse cx="6" cy="14" rx="7" ry="13" fill="${secondary}" opacity="0.4" transform="rotate(24 6 14)" />
    <circle cx="-6" cy="10" r="3.5" fill="${accent}" opacity="0.5" />
    <circle cx="2" cy="16" r="3.5" fill="${accent}" opacity="0.5" />
    <circle cx="-2" cy="20" r="3.5" fill="${accent}" opacity="0.5" />
  `,
  // A quiet radiant sunburst -- thin lines fanning from a small circle, a
  // "light/blessing" motif that doesn't commit to any one tradition's own
  // iconography (this event type spans many).
  reverent: (accent) => `
    <circle cx="0" cy="0" r="7" fill="none" stroke="${accent}" stroke-width="2" opacity="0.5" />
    ${[-60, -30, 0, 30, 60].map((deg) => `<line x1="0" y1="-11" x2="0" y2="-40" stroke="${accent}" stroke-width="1.5" opacity="0.4" transform="rotate(${deg})" />`).join("\n    ")}
  `,
};

// A shareable "you're invited" card: event details + the same QR code from
// the host's share page, generated as one image a host can post to a
// story/status or send directly in a text/WhatsApp message -- the site's
// existing print-only poster (app/qr/[slug]/page.jsx's .print-card) covers
// the "tape it up at the venue" case; this covers "forward it to someone
// who isn't there in person." Themed per getInviteMood(eventType) -- see
// lib/inviteMoods.js for the palette-per-event-type mapping (deliberately
// NOT the booking's video-editing style -- tried that first, but a
// "cinematic" style reading as a dark card looked wrong on, say, a
// wedding) and its "generic" fallback.
export async function buildInviteCard({ hostName, eventType, eventDate, eventTime, venue, uploadUrl, dateLabel, timeLabel }) {
  const mood = getInviteMood(eventType);

  // The whole 1080x1920 image IS the card now -- previously this was a
  // muted background poster with a smaller white panel floating in the
  // middle (a lot of dead space above/below the panel). Content now runs
  // edge-to-edge (minus this one padding), with the card's own rounded
  // corners and border being the canvas's own edges.
  const pad = 80;
  const contentX = pad;
  const contentRight = CARD_W - pad;
  const midX = (contentX + contentRight) / 2;
  const textMaxWidth = contentRight - contentX;

  // Matches the "<host>'s <event type>" convention used for the event name
  // everywhere else in the app (app/event/[eventId]/page.jsx,
  // app/gallery/[bookingId]/page.jsx, app/qr/[slug]/page.jsx) -- previously
  // this card showed the bare event type alone, so a host saw "Wedding"
  // here but "Sarah's Wedding" on every other page for the same booking.
  const eventName = hostName
    ? `${hostName}'s ${eventType || "Event"}`
    : (eventType || "You're Invited");

  const headlineLines = wrapText(eventName, 58, textMaxWidth, 3);
  const dateTimeLine = [dateLabel, timeLabel].filter(Boolean).join("   ·   ");
  const venueLines = venue ? wrapText(venue, 32, textMaxWidth, 2) : [];
  const taglineLines = wrapText(mood.tagline, 30, textMaxWidth, 2);
  const qrFrameSize = QR_SIZE + 80;

  // Lays out every section from a given top Y and reports where it ended.
  // Called once to measure the whole block's height, then again with a Y
  // that centers that block in the card -- a short invite (no venue, a
  // one-line headline) shouldn't leave the card looking bottom- or top-
  // heavy just because the layout was written top-down.
  function layout(startY) {
    let y = startY;
    const eyebrowY = y;
    y += 90;
    const headlineStartY = y;
    const headlineLineHeight = 66;
    y += headlineLines.length * headlineLineHeight;
    y += 46;
    const dividerY = y;
    y += 60;
    const dateY = y;
    y += 56;
    let venueY = null;
    if (venueLines.length) {
      venueY = y;
      y += venueLines.length * 42 + 20;
    }
    y += 26;
    const taglineY = y;
    y += taglineLines.length * 38;
    y += 34;
    const qrFrameY = y;
    y += qrFrameSize + 44;
    const footerY = y;
    y += 74;
    return { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, qrFrameY, footerY, endY: y };
  }

  const { endY: contentHeight } = layout(0);
  const startY = Math.max(120, Math.round((CARD_H - contentHeight) / 2));
  const { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, qrFrameY, footerY } = layout(startY);
  const qrFrameX = (CARD_W - qrFrameSize) / 2;

  // A diamond-centered divider below the headline -- recolored per mood
  // like everything else on this card.
  const ornamentalDivider = `
    <line x1="${contentX}" y1="${dividerY}" x2="${midX - 13}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />
    <rect x="${midX - 4.5}" y="${dividerY - 4.5}" width="9" height="9" fill="${mood.accent}" opacity="0.55" transform="rotate(45 ${midX} ${dividerY})" />
    <line x1="${midX + 13}" y1="${dividerY}" x2="${contentRight}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />`;
  // The mood's own motif (see MOTIFS above), once in the top-right corner
  // as drawn and once in the bottom-left rotated 180 degrees around its own
  // anchor point -- one hand-drawn shape, two symmetric placements, framing
  // the card the way a real invitation's corner ornamentation would.
  const motifSvg = (MOTIFS[mood.key] || MOTIFS.generic)(mood.accent, mood.blobs[1]);
  const cornerMotifs = `
    <g transform="translate(${CARD_W - 70} 86)">${motifSvg}</g>
    <g transform="translate(70 ${CARD_H - 86}) rotate(180)">${motifSvg}</g>`;

  const cardRadius = 56;

  const svg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="blob-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="70" />
    </filter>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${mood.card}" />
      <stop offset="100%" stop-color="${mood.bg}" />
    </linearGradient>
    <clipPath id="card-clip">
      <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="${cardRadius}" />
    </clipPath>
  </defs>
  <g clip-path="url(#card-clip)">
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg-grad)" />
    <circle cx="140" cy="160" r="260" fill="${mood.blobs[0]}" opacity="0.28" filter="url(#blob-blur)" />
    <circle cx="${CARD_W - 120}" cy="${CARD_H - 200}" r="300" fill="${mood.blobs[1]}" opacity="0.26" filter="url(#blob-blur)" />
    ${cornerMotifs}
    ${textPath("YOU'RE INVITED", contentX, eyebrowY, 28, mood.accent)}
    ${headlineLines.map((line, i) => textPath(line, contentX, headlineStartY + i * headlineLineHeight, 58, mood.text)).join("\n    ")}
    ${ornamentalDivider}
    ${textPath(dateTimeLine, contentX, dateY, 40, mood.text)}
    ${venueLines.map((line, i) => textPath(line, contentX, venueY + i * 42, 32, mood.muted)).join("\n    ")}
    ${taglineLines.map((line, i) => textPath(line, CARD_W / 2, taglineY + i * 38, 30, mood.accent, { align: "center" })).join("\n    ")}
    <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.4" />
    ${textPath("Scan or tap to RSVP & add your photos", CARD_W / 2, footerY, 27, mood.muted, { align: "center" })}
    ${textPath("No app needed", CARD_W / 2, footerY + 34, 22, mood.muted, { align: "center", opacity: 0.8 })}
    ${textPath(uploadUrl, CARD_W / 2, footerY + 68, 22, mood.muted, { align: "center", opacity: 0.75 })}
  </g>
  <rect x="1.5" y="1.5" width="${CARD_W - 3}" height="${CARD_H - 3}" rx="${cardRadius - 1.5}" fill="none" stroke="${mood.accent}" stroke-opacity="0.35" stroke-width="3" />
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
