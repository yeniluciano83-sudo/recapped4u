// One-time generator for public/images/marble-tablet.jpg -- the pricing
// tier card background on phone/tablet (app/page.jsx / app/booking/page.jsx).
// Same model and blind-emboss visual language as
// scripts/generate-invite-backgrounds.mjs, not run at request time -- this
// is a static asset, regenerated only when deliberately redoing it.
//
// Used to also generate a two-columns-and-plinth mobile/tablet page
// background (public/images/mobile-bg-pillars.jpg, itself a replacement for
// an even earlier wave-sand version) -- removed outright, not reverted to
// either earlier version, so this file only ever describes what's actually
// still in use.
//
// Usage: node --env-file=.env.local scripts/generate-roman-theme-backgrounds.mjs
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import path from "path";
import fs from "fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const DEST = path.join(process.cwd(), "public", "images", "marble-tablet.jpg");

// Same blind-emboss language as the invite backgrounds' own STYLE_SUFFIX --
// pressed into the material itself, not printed in any ink or color, so
// this reads as the same visual family as the rest of the site's emboss
// work rather than a new, unrelated illustration style.
const STYLE_SUFFIX =
  "Photographed macro, in a single-tone blind-emboss / carved relief -- any detail is pressed into the material itself, not painted or inked, reading in the exact same soft ivory-white tone as the material around it, revealed only by soft raking studio light casting delicate, precise shadows and highlights. Extremely elegant, minimal, sophisticated. No ink, no color, no text, no people.";

const PROMPT = `A smooth polished slab of ancient Roman marble with natural subtle veining, vertical portrait format. A thin carved decorative border frame runs around the outer edge only -- a simple classical fillet-and-bead molding line about 6% of the frame's width in from each edge. The entire large center area, at least 80% of the frame, is completely bare, smooth, softly lit blank polished marble with no carving, no border detail, no motif of any kind -- reserved deliberately empty for a pricing card's own text. ${STYLE_SUFFIX}`;

const res = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: PROMPT,
  config: { imageConfig: { aspectRatio: "3:4" } },
});
const parts = res.candidates?.[0]?.content?.parts || [];
const imgPart = parts.find((p) => p.inlineData);
if (!imgPart) {
  console.error("FAILED - no image returned:", parts.find((p) => p.text)?.text?.slice(0, 300));
  process.exit(1);
}
const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");

// brightness 1.2 / saturation 0.55, not the invite backgrounds' own
// 1.16 / 0.75 -- confirmed live that this specific marble's real grey
// veining needed a bigger saturation cut than warm ivory cardstock ever
// did to read as "white cream" rather than grey-veined Carrara marble, the
// same known Gemini-brightness gap lib/inviteCard.js's own comment already
// documents, just further along it for this particular source image.
const outBuf = await sharp(rawBuf).modulate({ brightness: 1.2, saturation: 0.55 }).jpeg({ quality: 90 }).toBuffer();

// Same tmp-then-rename dance as generate-invite-backgrounds.mjs -- a direct
// overwrite of an existing asset path intermittently fails on Windows while
// next dev's file watcher holds it open.
const tmpPath = `${DEST}.tmp-${process.pid}`;
fs.writeFileSync(tmpPath, outBuf);
fs.renameSync(tmpPath, DEST);
console.log(`saved ${outBuf.length} bytes -> ${DEST}`);
