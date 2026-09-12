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

// One real, AI-illustrated background per mood -- a hand-designed-looking
// watercolor frame (florals, balloons+confetti, a laurel-and-navy frame,
// botanical leaves, a holly garland, a soft radiant frame, or a warm
// abstract frame) with its outer border decorated and its center left
// clear on purpose, generated once via Gemini (see
// scripts/generate-invite-backgrounds.mjs) and committed as a static
// asset -- not regenerated per request, so this costs nothing extra at
// share time. Replaces an earlier pass at hand-coded SVG corner line-art
// (dots, then bigger dots) that never stopped looking like placeholder
// art no matter how much it was scaled up; real illustration was the
// actual gap, not more tweaking of geometric shapes.
const BACKGROUND_DIR = path.join(process.cwd(), "lib", "assets", "invite-backgrounds");

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
// showRsvp: true for the shareable "you're invited" image (sent before the
// event, when RSVPing is still the point); false for the printed poster
// (app/qr/[slug]/page.jsx's print-card, taped up at the event itself,
// where "Will you be there?" no longer makes sense -- the guest is
// already there) -- see the GET route's own `rsvp` query param.
export async function buildInviteCard({ hostName, eventType, eventDate, eventTime, venue, uploadUrl, dateLabel, timeLabel, showRsvp = true }) {
  const mood = getInviteMood(eventType);

  // Text sits well inside the illustrated background's own decorated
  // border (see BACKGROUND_DIR above) rather than running edge-to-edge --
  // each background was generated with its outer border decorated and its
  // center two-thirds left clear specifically for this text to sit in.
  const pad = 130;
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
    : (eventType || (showRsvp ? "You're Invited" : "This Event"));

  const headlineLines = wrapText(eventName, 58, textMaxWidth, 3);
  const dateTimeLine = [dateLabel, timeLabel].filter(Boolean).join("   ·   ");
  const venueLines = venue ? wrapText(venue, 32, textMaxWidth, 2) : [];
  // Sizes for the tagline (right above the QR) and the footer block (right
  // below it) -- bumped up from an earlier pass that read too small next
  // to the real illustrated backgrounds' own visual weight.
  const TAGLINE_SIZE = 34;
  const TAGLINE_LINE_HEIGHT = 42;
  const FOOTER1_SIZE = 31;
  const FOOTER2_SIZE = 25;
  const FOOTER2_OFFSET = 40;
  const URL_SIZE = 23;
  const URL_OFFSET = 78;
  const RSVP_LABEL_SIZE = 24;
  const RSVP_PILL_FONT_SIZE = 26;
  const RSVP_PILL_HEIGHT = 52;
  const RSVP_PILL_GAP = 16;
  const RSVP_PILL_PAD_X = 30;
  const RSVP_OPTIONS = ["Yes", "Maybe", "No"];

  // "YOU'RE INVITED" / mood.tagline ("We can't wait to celebrate with
  // you", etc.) are pre-event language, written for something sent out
  // ahead of time -- wrong on the printed poster (showRsvp: false), which
  // gets taped up at the event itself, for a guest who's already there.
  const eyebrowText = showRsvp ? "YOU'RE INVITED" : "SHARE YOUR PHOTOS";
  const tagline = showRsvp ? mood.tagline : "Help us capture today's memories";
  const taglineLines = wrapText(tagline, TAGLINE_SIZE, textMaxWidth, 2);
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
    y += taglineLines.length * TAGLINE_LINE_HEIGHT;
    y += 34;
    let rsvpLabelY = null;
    let rsvpPillY = null;
    if (showRsvp) {
      rsvpLabelY = y;
      y += 44;
      rsvpPillY = y;
      y += RSVP_PILL_HEIGHT + 30;
    }
    const qrFrameY = y;
    y += qrFrameSize + 44;
    const footerY = y;
    y += URL_OFFSET + 8;
    return { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, rsvpLabelY, rsvpPillY, qrFrameY, footerY, endY: y };
  }

  const { endY: contentHeight } = layout(0);
  const startY = Math.max(180, Math.round((CARD_H - contentHeight) / 2));
  const { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, rsvpLabelY, rsvpPillY, qrFrameY, footerY } = layout(startY);
  const qrFrameX = (CARD_W - qrFrameSize) / 2;

  // A row of non-interactive pills previewing the actual Yes/Maybe/No RSVP
  // buttons on the guest page the QR/link below opens (app/event/[eventId]
  // /page.jsx) -- can't be tapped on a static image, but shows a guest
  // what to expect (and that RSVPing is even a thing) before they scan,
  // the way a printed invitation's own response card lists its options
  // up front. Widths measured per-label (not a fixed pill size) since
  // "Maybe" is meaningfully wider than "Yes"/"No". Skipped entirely for
  // the printed poster (showRsvp: false) -- see buildInviteCard's own
  // comment for why.
  let rsvpPillsSvg = "";
  if (showRsvp) {
    let rsvpPillX = 0;
    const rsvpPills = RSVP_OPTIONS.map((label) => {
      const w = measureWidth(label, RSVP_PILL_FONT_SIZE) + RSVP_PILL_PAD_X * 2;
      rsvpPillX += w + RSVP_PILL_GAP;
      return { label, w };
    });
    const rsvpRowWidth = rsvpPillX - RSVP_PILL_GAP;
    let rsvpCursorX = CARD_W / 2 - rsvpRowWidth / 2;
    rsvpPillsSvg = rsvpPills
      .map(({ label, w }) => {
        const x = rsvpCursorX;
        rsvpCursorX += w + RSVP_PILL_GAP;
        const textY = rsvpPillY + RSVP_PILL_HEIGHT / 2 + RSVP_PILL_FONT_SIZE * 0.36;
        return `
    <rect x="${x}" y="${rsvpPillY}" width="${w}" height="${RSVP_PILL_HEIGHT}" rx="${RSVP_PILL_HEIGHT / 2}" fill="none" stroke="${mood.accent}" stroke-width="2" opacity="0.7" />
    ${textPath(label, x + w / 2, textY, RSVP_PILL_FONT_SIZE, mood.text, { align: "center" })}`;
      })
      .join("\n");
  }

  // A simple diamond-centered divider below the headline -- the mood's own
  // illustrated background (see BACKGROUND_DIR above) now carries the real
  // decorative weight, so this stays a plain, quiet accent rather than
  // trying to compete with it.
  const ornamentalDivider = `
    <line x1="${contentX}" y1="${dividerY}" x2="${midX - 13}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />
    <rect x="${midX - 4.5}" y="${dividerY - 4.5}" width="9" height="9" fill="${mood.accent}" opacity="0.55" transform="rotate(45 ${midX} ${dividerY})" />
    <line x1="${midX + 13}" y1="${dividerY}" x2="${contentRight}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />`;

  // A soft translucent panel behind the text blocks -- confirmed live that
  // pinning text to a fixed inset isn't reliable across seven independently
  // hand-illustrated backgrounds: professional's laurel branch runs the
  // full height close to the edge (not just near the top, and not a
  // straight column either -- the branch itself weaves), so "YOU'RE
  // INVITED" still sat on top of a leaf even after a mood-specific extra
  // inset. A scrim (mood.card, i.e. white on light moods / dark navy on
  // professional) guarantees contrast regardless of exactly where any
  // given background's artwork falls, the way a real printed invitation
  // often sits text on its own translucent card over a busier scene.
  const scrimPad = 26;
  const mainScrimBottom = showRsvp
    ? rsvpPillY + RSVP_PILL_HEIGHT + 14
    : taglineY + taglineLines.length * TAGLINE_LINE_HEIGHT + 14;
  const mainScrim = `<rect x="${contentX - scrimPad}" y="${eyebrowY - 50}" width="${contentRight - contentX + scrimPad * 2}" height="${mainScrimBottom - (eyebrowY - 50)}" rx="24" fill="${mood.card}" opacity="0.6" />`;
  const footerScrim = `<rect x="${contentX - scrimPad}" y="${footerY - 20}" width="${contentRight - contentX + scrimPad * 2}" height="${footerY + URL_OFFSET + 16 - (footerY - 20)}" rx="24" fill="${mood.card}" opacity="0.6" />`;

  // Text and the QR's own white scan-safe panel, as one transparent-
  // background SVG composited over the illustrated background PNG below --
  // no card background, blobs, or border drawn here any more, since the
  // background image already provides all of that.
  const overlaySvg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${mainScrim}
  ${textPath(eyebrowText, contentX, eyebrowY, 28, mood.accent)}
  ${headlineLines.map((line, i) => textPath(line, contentX, headlineStartY + i * headlineLineHeight, 58, mood.text)).join("\n  ")}
  ${ornamentalDivider}
  ${textPath(dateTimeLine, contentX, dateY, 40, mood.text)}
  ${venueLines.map((line, i) => textPath(line, contentX, venueY + i * 42, 32, mood.muted)).join("\n  ")}
  ${taglineLines.map((line, i) => textPath(line, CARD_W / 2, taglineY + i * TAGLINE_LINE_HEIGHT, TAGLINE_SIZE, mood.accent, { align: "center" })).join("\n  ")}
  ${showRsvp ? textPath("WILL YOU BE THERE?", CARD_W / 2, rsvpLabelY, RSVP_LABEL_SIZE, mood.muted, { align: "center" }) : ""}
  ${rsvpPillsSvg}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.5" />
  ${footerScrim}
  ${textPath(showRsvp ? "Scan or tap to RSVP & add your photos" : "Scan or tap to add your photos", CARD_W / 2, footerY, FOOTER1_SIZE, mood.muted, { align: "center" })}
  ${textPath("No app needed", CARD_W / 2, footerY + FOOTER2_OFFSET, FOOTER2_SIZE, mood.muted, { align: "center", opacity: 0.8 })}
  ${textPath(uploadUrl, CARD_W / 2, footerY + URL_OFFSET, URL_SIZE, mood.muted, { align: "center", opacity: 0.75 })}
</svg>`;

  if (process.env.DEBUG_INVITE_SVG) fs.writeFileSync(process.env.DEBUG_INVITE_SVG, overlaySvg);

  const backgroundPath = path.join(BACKGROUND_DIR, `${mood.key}.jpg`);
  const [backgroundBuffer, overlayBuffer, qrBuffer] = await Promise.all([
    // fit: "cover" -- the generated art is ~9:16 but not pixel-exact, so
    // this crops a few px off the sides/top rather than distorting it.
    sharp(backgroundPath).resize(CARD_W, CARD_H, { fit: "cover" }).png().toBuffer()
      // No text renders on a flat fallback fill rather than a 500 on every
      // invite share -- see the FONT load's own try/catch above for the
      // same reasoning. Shouldn't happen (the asset ships with the repo)
      // but a missing/corrupt file is still cheaper to survive than crash.
      .catch((err) => {
        console.error("Invite background image failed to load:", err.message);
        return sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: mood.bg } }).png().toBuffer();
      }),
    sharp(Buffer.from(overlaySvg)).png().toBuffer(),
    generateQrPngBuffer(uploadUrl),
  ]);

  return sharp(backgroundBuffer)
    .composite([
      { input: overlayBuffer },
      { input: qrBuffer, left: Math.round(qrFrameX + 40), top: Math.round(qrFrameY + 40) },
    ])
    // JPEG, not PNG -- the real illustrated background is photographic
    // (soft watercolor gradients/texture, not flat vector color), which
    // makes it compress far worse losslessly: this same card was 2-3MB as
    // a PNG vs ~250-300KB here, too large for a "share this in a text"
    // feature. Quality 90 confirmed visually lossless by eye and confirmed
    // with jsQR that the QR code (errorCorrectionLevel "H" -- see
    // lib/qrGenerate.js) still decodes correctly at both 90 and 85.
    .jpeg({ quality: 90 })
    .toBuffer();
}
