// Shared vector-text rendering for every generated share card (the guest
// invite in lib/inviteCard.js, and the host's recap-reveal card in
// lib/recapCard.js) -- extracted here so both draw text the exact same way
// instead of two copies of the same opentype.js plumbing quietly drifting.
import fs from "fs";
import path from "path";
import opentypeModule from "opentype.js/dist/opentype.js";

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
// Next.js serverless function. Parsed once per process; every card render
// after the first reuses the same Font object.
//
// opentype.js's own text-shaping path (Font.getPath/getAdvanceWidth) runs
// every string through its GSUB/Bidi feature engine first, and that engine
// doesn't support one of the lookup formats in this font's GSUB table --
// confirmed live, it throws "substitutionType : 62 lookupType: 6 -
// substFormat: 2 is not yet supported" on every single call, not something
// an options flag can turn off (ccmp is applied unconditionally regardless
// of the `features` option). glyphsToPath below bypasses that whole
// pipeline -- charToGlyph is a plain cmap lookup with no shaping -- which
// costs ligatures/kerning these cards were never using anyway.
const FONT_PATH = path.join(process.cwd(), "lib", "fonts", "Oswald-Bold.ttf");
let FONT = null;
try {
  FONT = opentype.parse(fs.readFileSync(FONT_PATH));
} catch (err) {
  // No text renders below (see textPath) rather than a 500 on every card
  // request -- a card with just the background/QR still beats a broken
  // feature end-to-end.
  console.error("Card font failed to load:", err.message);
}

// Oswald has no italic variant shipped in lib/fonts/, and pulling in a
// second font file just for a handful of moods' worth of copy is a lot of
// new surface area for one slant -- shearing the already-rendered outlines
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

export function measureWidth(str, fontSize) {
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
// upright text stay centered/aligned identically either way. `stroke`/
// `strokeWidth` add a thin outline behind the fill -- the guest invite
// never needs this (its background is a flat illustrated tone with a
// dedicated scrim), but lib/recapCard.js's text sits over an arbitrary
// real photo, where no single scrim strength reads well against every
// possible patch of it (confirmed live: light accent text disappeared
// against a dark graduation cap right behind it despite the scrim). An
// outline keeps text legible from the glyph's own edge contrast, not just
// whatever's directly behind it. Returns "" (renders nothing) when FONT
// never loaded.
export function textPath(str, x, y, fontSize, fill, { align = "left", opacity, italic, stroke, strokeWidth } = {}) {
  if (!FONT || !str) return "";
  const width = align === "center" ? measureWidth(str, fontSize) : 0;
  const drawX = align === "center" ? x - width / 2 : x;
  const d = commandsToPathData(glyphsToPath(str, drawX, y, fontSize, italic).path.commands);
  const strokeAttrs = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth || 1}" stroke-linejoin="round"` : "";
  return `<path d="${d}" fill="${fill}"${opacity != null ? ` opacity="${opacity}"` : ""}${strokeAttrs} />`;
}

// SVG paths don't auto-wrap -- greedy word-wrap into at most maxLines using
// the font's own advance width (not a character-count guess), ellipsizing
// whatever's left over on the last line. Good enough for a decorative
// card (a host's own event-type/venue text, not a document); a single
// word wider than maxWidth on its own is just left to overflow slightly
// rather than being hyphenated.
export function wrapText(str, fontSize, maxWidth, maxLines) {
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
