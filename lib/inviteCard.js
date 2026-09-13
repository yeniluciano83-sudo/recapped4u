import fs from "fs";
import path from "path";
import sharp from "sharp";
import opentypeModule from "opentype.js/dist/opentype.js";
import { getInviteMood, NON_ITALIC_MOODS } from "./inviteMoods.js";
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

// The digital invite's canvas -- a phone-story shape (9:16), meant to be
// viewed on a screen or posted to a Story.
const DIGITAL_CARD_W = 1080;
const DIGITAL_CARD_H = 1920;
// The printed card's own canvas -- landscape, not a taller/shorter crop of
// the digital invite's portrait shape. Laid flat on a table or taped up
// sideways it reads like a flyer/table card; a stacked portrait layout
// (tried first, at 3:4) still felt visually "narrow" for that use, so the
// printed card gets a genuinely different side-by-side layout (event
// details on the left, QR on the right -- see buildPrintOverlay below)
// rather than just a differently-proportioned version of the same stack.
const PRINT_CARD_W = 1600;
const PRINT_CARD_H = 1080;

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

// Oswald has no italic variant shipped in lib/fonts/, and pulling in a
// second font file just for five moods' worth of copy is a lot of new
// surface area for one slant -- shearing the already-rendered outlines
// is the same trick software has used to synthesize italics forever
// (it's literally what CSS does for font-style: oblique on a family with
// no real italic). Each point shifts in x by SHEAR times its own distance
// from the line's baseline (`y`, constant for every point on one line),
// not a flat offset -- that's what makes it an actual per-glyph slant
// (curves lean progressively toward their tallest point) instead of just
// nudging the whole line sideways.
const ITALIC_SHEAR = 0.22;

function shearCommands(commands, baselineY) {
  const shearX = (px, py) => px + ITALIC_SHEAR * (baselineY - py);
  return commands.map((cmd) => {
    const sheared = { ...cmd };
    if (sheared.x !== undefined) sheared.x = shearX(sheared.x, sheared.y);
    if (sheared.x1 !== undefined) sheared.x1 = shearX(sheared.x1, sheared.y1);
    if (sheared.x2 !== undefined) sheared.x2 = shearX(sheared.x2, sheared.y2);
    return sheared;
  });
}

// One glyph per character, laid out left-to-right and merged into a single
// Path -- see the FONT loading comment above for why this doesn't go
// through font.getPath/getAdvanceWidth.
function glyphsToPath(str, x, y, fontSize, italic) {
  const scale = fontSize / FONT.unitsPerEm;
  const fullPath = new opentype.Path();
  let cx = x;
  for (const ch of String(str)) {
    const glyph = FONT.charToGlyph(ch);
    fullPath.extend(glyph.getPath(cx, y, fontSize));
    cx += (glyph.advanceWidth || 0) * scale;
  }
  if (italic) fullPath.commands = shearCommands(fullPath.commands, y);
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
// equivalent, so a centered line is measured and shifted by hand. `italic`
// shears the rendered glyphs -- see ITALIC_SHEAR above -- measured width
// is unaffected (a shear doesn't change advance widths), so italic and
// upright text stay centered/aligned identically either way. Returns ""
// (renders nothing) when FONT never loaded.
function textPath(str, x, y, fontSize, fill, { align = "left", opacity, italic } = {}) {
  if (!FONT || !str) return "";
  const width = align === "center" ? measureWidth(str, fontSize) : 0;
  const drawX = align === "center" ? x - width / 2 : x;
  const d = commandsToPathData(glyphsToPath(str, drawX, y, fontSize, italic).path.commands);
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
// A second set of the same seven moods, generated at the printed card's
// own landscape shape (see PRINT_CARD_W/PRINT_CARD_H above) rather than
// the digital invite's tall 9:16 -- simply stretching or re-cropping the
// 9:16 art would distort or cut off its own border decoration, so this is
// dedicated art, not a resize of the other set.
const PRINT_BACKGROUND_DIR = path.join(process.cwd(), "lib", "assets", "invite-backgrounds-print");

// The shareable, pre-event "you're invited" overlay: a vertically-stacked,
// centered layout (eyebrow, headline, date/venue, tagline, RSVP pills,
// then the QR code and footer) sized for the digital invite's tall 9:16
// canvas. Matches the "<host>'s <event type>" convention used for the
// event name everywhere else in the app (app/event/[eventId]/page.jsx,
// app/gallery/[bookingId]/page.jsx, app/qr/[slug]/page.jsx) -- previously
// this card showed the bare event type alone, so a host saw "Wedding" here
// but "Sarah's Wedding" on every other page for the same booking.
function buildDigitalOverlay({ hostName, eventType, dateTimeLine, venue, mood }) {
  const CARD_W = DIGITAL_CARD_W;
  const CARD_H = DIGITAL_CARD_H;
  const italic = !NON_ITALIC_MOODS.has(mood.key);

  // Text sits well inside the illustrated background's own decorated
  // border (see BACKGROUND_DIR above) rather than running edge-to-edge --
  // each background was generated with its outer border decorated and its
  // center two-thirds left clear specifically for this text to sit in.
  const pad = 150;
  const contentX = pad;
  const contentRight = CARD_W - pad;
  const midX = (contentX + contentRight) / 2;
  const textMaxWidth = contentRight - contentX;

  const eventName = hostName ? `${hostName}'s ${eventType || "Event"}` : (eventType || "You're Invited");
  const headlineLines = wrapText(eventName, 58, textMaxWidth, 3);
  const venueLines = venue ? wrapText(venue, 32, textMaxWidth, 2) : [];
  // Sizes for the tagline (right above the QR) and the footer block (right
  // below it) -- bumped up from an earlier pass that read too small next
  // to the real illustrated backgrounds' own visual weight.
  const TAGLINE_SIZE = 34;
  const TAGLINE_LINE_HEIGHT = 42;
  const FOOTER1_SIZE = 31;
  const FOOTER2_SIZE = 25;
  const FOOTER2_OFFSET = 40;

  const eyebrowText = "YOU'RE INVITED";
  const taglineLines = wrapText(mood.tagline, TAGLINE_SIZE, textMaxWidth, 2);
  const footerLine1 = "Scan or tap to RSVP & add your photos";
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
    y += 44;
    const qrFrameY = y;
    y += qrFrameSize + 44;
    const footerY = y;
    y += FOOTER2_OFFSET + 30;
    return { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, qrFrameY, footerY, endY: y };
  }

  // Minimum top margin as a fraction of the card's own height rather than
  // a flat pixel value, so the same proportions hold if this canvas size
  // is ever tuned again.
  const { endY: contentHeight } = layout(0);
  const minTopMargin = Math.round(CARD_H * (180 / 1920));
  const startY = Math.max(minTopMargin, Math.round((CARD_H - contentHeight) / 2));
  const { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, qrFrameY, footerY } = layout(startY);
  const qrFrameX = (CARD_W - qrFrameSize) / 2;

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
  // Tighter pad + lower opacity than the original colorful-illustration
  // pass -- confirmed live that the old 26px/0.6 combo, sized for hiding a
  // busy saturated scene, was swallowing almost the entire embossed motif
  // on the new tone-on-tone cardstock backgrounds. That art is already
  // low-contrast (same near-white tone as the card itself), so it needs
  // much less covering to keep dark text legible.
  const scrimPad = 12;
  const mainScrimBottom = taglineY + taglineLines.length * TAGLINE_LINE_HEIGHT + 14;
  const mainScrim = `<rect x="${contentX - scrimPad}" y="${eyebrowY - 50}" width="${contentRight - contentX + scrimPad * 2}" height="${mainScrimBottom - (eyebrowY - 50)}" rx="24" fill="${mood.card}" opacity="0.4" />`;
  // Matches the QR frame's own width -- the footer caption below the QR is
  // never wider than that (no raw URL line to overflow it any more, see
  // the removed uploadUrl textPath below), so a fixed width reads as a
  // caption that visually belongs to the QR box instead of a mismatched
  // wider block floating under a narrower one.
  const footerScrimWidth = qrFrameSize + scrimPad * 2;
  const footerScrimX = qrFrameX + qrFrameSize / 2 - footerScrimWidth / 2;
  const footerScrim = `<rect x="${footerScrimX}" y="${footerY - 20}" width="${footerScrimWidth}" height="${footerY + FOOTER2_OFFSET + 16 - (footerY - 20)}" rx="24" fill="${mood.card}" opacity="0.4" />`;

  // Text and the QR's own white scan-safe panel, as one transparent-
  // background SVG composited over the illustrated background PNG below --
  // no card background, blobs, or border drawn here any more, since the
  // background image already provides all of that.
  const overlaySvg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${mainScrim}
  ${textPath(eyebrowText, CARD_W / 2, eyebrowY, 28, mood.accent, { align: "center", italic })}
  ${headlineLines.map((line, i) => textPath(line, CARD_W / 2, headlineStartY + i * headlineLineHeight, 58, mood.text, { align: "center", italic })).join("\n  ")}
  ${ornamentalDivider}
  ${textPath(dateTimeLine, CARD_W / 2, dateY, 40, mood.text, { align: "center", italic })}
  ${venueLines.map((line, i) => textPath(line, CARD_W / 2, venueY + i * 42, 32, mood.muted, { align: "center", italic })).join("\n  ")}
  ${taglineLines.map((line, i) => textPath(line, CARD_W / 2, taglineY + i * TAGLINE_LINE_HEIGHT, TAGLINE_SIZE, mood.accent, { align: "center", italic })).join("\n  ")}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.5" />
  ${footerScrim}
  ${textPath(footerLine1, CARD_W / 2, footerY, FOOTER1_SIZE, mood.muted, { align: "center", italic })}
  ${textPath("No app needed", CARD_W / 2, footerY + FOOTER2_OFFSET, FOOTER2_SIZE, mood.muted, { align: "center", opacity: 0.8, italic })}
</svg>`;

  return { CARD_W, CARD_H, overlaySvg, qrFrameX, qrFrameY };
}

// The printed card's overlay: a landscape, side-by-side layout -- event
// details in a left column, the QR code + footer in a right column --
// rather than the digital invite's vertical stack. Built as its own
// layout (not a reflow of buildDigitalOverlay) since the two aren't the
// same shape with different numbers: this one has no RSVP row (see the
// GET route's own `rsvp` query param -- a guest scanning a card taped up
// at the event itself is already there, so "Will you be there?" doesn't
// apply) and its "Scan to add your photos" footer skips "...or tap" since
// a physical printed card can't be tapped at all.
function buildPrintOverlay({ hostName, eventType, dateTimeLine, venue, mood }) {
  const CARD_W = PRINT_CARD_W;
  const CARD_H = PRINT_CARD_H;
  const italic = !NON_ITALIC_MOODS.has(mood.key);
  const pad = 80;
  const qrFrameSize = QR_SIZE + 80;
  const colGap = 60;

  // Right column: the QR frame, right-aligned with an even margin from the
  // edge; left column: everything else, filling the remaining width.
  const qrFrameX = CARD_W - pad - qrFrameSize;
  const rightColCenterX = qrFrameX + qrFrameSize / 2;
  const contentX = pad;
  const contentRight = qrFrameX - colGap;
  const midX = (contentX + contentRight) / 2;
  const textMaxWidth = contentRight - contentX;

  const eventName = hostName ? `${hostName}'s ${eventType || "Event"}` : (eventType || "This Event");
  const headlineLines = wrapText(eventName, 54, textMaxWidth, 3);
  const venueLines = venue ? wrapText(venue, 30, textMaxWidth, 2) : [];
  const TAGLINE_SIZE = 30;
  const TAGLINE_LINE_HEIGHT = 38;
  const taglineLines = wrapText("Help us capture today's memories", TAGLINE_SIZE, textMaxWidth, 2);

  const FOOTER1_SIZE = 28;
  const FOOTER2_SIZE = 22;
  const FOOTER2_OFFSET = 36;
  const eyebrowText = "SHARE YOUR PHOTOS";
  const footerLine1 = "Scan to add your photos";

  // Left column: a vertical stack (eyebrow, headline, date/venue, tagline)
  // centered as a block within the card's full height.
  function leftLayout(startY) {
    let y = startY;
    const eyebrowY = y;
    y += 70;
    const headlineStartY = y;
    const headlineLineHeight = 58;
    y += headlineLines.length * headlineLineHeight;
    y += 36;
    const dividerY = y;
    y += 50;
    const dateY = y;
    y += 48;
    let venueY = null;
    if (venueLines.length) {
      venueY = y;
      y += venueLines.length * 38 + 16;
    }
    y += 22;
    const taglineY = y;
    y += taglineLines.length * TAGLINE_LINE_HEIGHT;
    return { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY, endY: y };
  }
  const { endY: leftContentHeight } = leftLayout(0);
  const leftStartY = Math.max(70, Math.round((CARD_H - leftContentHeight) / 2));
  const { eyebrowY, headlineStartY, headlineLineHeight, dividerY, dateY, venueY, taglineY } = leftLayout(leftStartY);

  // Right column: the QR frame plus its footer text below it, centered as
  // a block within the card's full height, independent of the left
  // column's own content length.
  const footerBlockHeight = FOOTER2_OFFSET + 12;
  const rightGap = 56;
  const rightContentHeight = qrFrameSize + rightGap + footerBlockHeight;
  const qrFrameY = Math.max(50, Math.round((CARD_H - rightContentHeight) / 2));
  const footerY = qrFrameY + qrFrameSize + rightGap;

  // Same quiet diamond divider as the digital invite, spanning only the
  // left column here since the right column holds the QR frame instead.
  const ornamentalDivider = `
    <line x1="${contentX}" y1="${dividerY}" x2="${midX - 13}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />
    <rect x="${midX - 4.5}" y="${dividerY - 4.5}" width="9" height="9" fill="${mood.accent}" opacity="0.55" transform="rotate(45 ${midX} ${dividerY})" />
    <line x1="${midX + 13}" y1="${dividerY}" x2="${contentRight}" y2="${dividerY}" stroke="${mood.accent}" stroke-opacity="0.4" stroke-width="1.5" />`;

  // Two independent scrims (left text block, right QR+footer block) rather
  // than one spanning both columns -- see buildDigitalOverlay's own scrim
  // comment for why a translucent panel beats a fixed inset here. Same
  // tighter pad/lower opacity as that overlay's own scrim, for the same
  // reason: the tone-on-tone emboss art needs far less covering than the
  // old colorful illustrations did to keep text legible.
  const scrimPad = 12;
  const leftScrimBottom = taglineY + taglineLines.length * TAGLINE_LINE_HEIGHT + 14;
  const leftScrim = `<rect x="${contentX - scrimPad}" y="${eyebrowY - 46}" width="${contentRight - contentX + scrimPad * 2}" height="${leftScrimBottom - (eyebrowY - 46)}" rx="24" fill="${mood.card}" opacity="0.4" />`;
  // Matches the QR frame's own width -- see buildDigitalOverlay's identical
  // footer-scrim comment for why a fixed width is enough now that there's
  // no raw URL line to potentially overflow it.
  const rightScrimWidth = qrFrameSize + scrimPad * 2;
  const rightScrimX = qrFrameX + qrFrameSize / 2 - rightScrimWidth / 2;
  const rightScrim = `<rect x="${rightScrimX}" y="${qrFrameY - scrimPad}" width="${rightScrimWidth}" height="${footerY + FOOTER2_OFFSET + 16 - (qrFrameY - scrimPad)}" rx="24" fill="${mood.card}" opacity="0.4" />`;

  const overlaySvg = `
<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  ${leftScrim}
  ${textPath(eyebrowText, contentX, eyebrowY, 26, mood.accent, { italic })}
  ${headlineLines.map((line, i) => textPath(line, contentX, headlineStartY + i * headlineLineHeight, 54, mood.text, { italic })).join("\n  ")}
  ${ornamentalDivider}
  ${textPath(dateTimeLine, contentX, dateY, 36, mood.text, { italic })}
  ${venueLines.map((line, i) => textPath(line, contentX, venueY + i * 38, 30, mood.muted, { italic })).join("\n  ")}
  ${taglineLines.map((line, i) => textPath(line, contentX, taglineY + i * TAGLINE_LINE_HEIGHT, TAGLINE_SIZE, mood.accent, { italic })).join("\n  ")}
  ${rightScrim}
  <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="28" fill="#FFFFFF" stroke="${mood.accent}" stroke-width="2" stroke-opacity="0.5" />
  ${textPath(footerLine1, rightColCenterX, footerY, FOOTER1_SIZE, mood.muted, { align: "center", italic })}
  ${textPath("No app needed", rightColCenterX, footerY + FOOTER2_OFFSET, FOOTER2_SIZE, mood.muted, { align: "center", opacity: 0.8, italic })}
</svg>`;

  return { CARD_W, CARD_H, overlaySvg, qrFrameX, qrFrameY };
}

// A shareable "you're invited" card: event details + the same QR code from
// the host's share page. showRsvp: true builds the digital, pre-event
// image (posted to a story/status or sent in a text/WhatsApp message,
// vertical, framed as an RSVP invite); false builds the printed card (a
// landscape flyer/table card the host prints and tapes up or sets out at
// the event itself, framed as "add your photos" instead). Neither draws
// actual Yes/Maybe/No RSVP controls any more -- a static image or a piece
// of paper can't respond to a tap, so that only ever lived on the real
// guest page (app/event/[eventId]/EventPageClient.jsx); this card's job is
// just to get a guest to that page. Themed per getInviteMood(eventType) --
// see
// lib/inviteMoods.js for the palette-per-event-type mapping (deliberately
// NOT the booking's video-editing style -- tried that first, but a
// "cinematic" style reading as a dark card looked wrong on, say, a
// wedding) and its "generic" fallback.
export async function buildInviteCard({ hostName, eventType, eventDate, eventTime, venue, uploadUrl, dateLabel, timeLabel, showRsvp = true }) {
  const mood = getInviteMood(eventType);
  const dateTimeLine = [dateLabel, timeLabel].filter(Boolean).join("   ·   ");

  const { CARD_W, CARD_H, overlaySvg, qrFrameX, qrFrameY } = showRsvp
    ? buildDigitalOverlay({ hostName, eventType, dateTimeLine, venue, mood })
    : buildPrintOverlay({ hostName, eventType, dateTimeLine, venue, mood });

  if (process.env.DEBUG_INVITE_SVG) fs.writeFileSync(process.env.DEBUG_INVITE_SVG, overlaySvg);

  const backgroundPath = path.join(showRsvp ? BACKGROUND_DIR : PRINT_BACKGROUND_DIR, `${mood.key}.jpg`);
  const [backgroundBuffer, overlayBuffer, qrBuffer] = await Promise.all([
    // fit: "cover" -- the generated art isn't pixel-exact to the target
    // ratio, so this crops a few px off the sides/top rather than
    // distorting it. Gemini's own output tops out well under this card's
    // own canvas (768px-wide master vs. a 1080-1600px card -- confirmed
    // live that imageConfig.imageSize is a no-op on this model, see
    // scripts/generate-invite-backgrounds.mjs's own comment), so this
    // resize is a real upscale, not just a crop -- sharpen counteracts the
    // softness that introduces instead of shipping a visibly blurrier
    // card than the master art actually looks like at its native size.
    // modulate's brightness lift -- Gemini's own read of "creamy ivory
    // cardstock" for this blind-emboss style consistently comes back a
    // shade closer to beige/khaki than the bright white cardstock the
    // design actually calls for; a small saturation cut alongside it
    // keeps that lift from just making the beige look washed-out instead
    // of genuinely whiter.
    sharp(backgroundPath).resize(CARD_W, CARD_H, { fit: "cover" }).modulate({ brightness: 1.16, saturation: 0.75 }).sharpen({ sigma: 1.1 }).png().toBuffer()
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
