// One-time generator for public/images/tier-icons/<tier>.jpg -- small,
// square "sticker" icons shown on each pricing card (app/page.jsx's TIERS),
// replacing the plain lucide icon-on-flat-color badge that sat there
// before. Not run at request time: static assets committed to the repo,
// generated once (or whenever a tier's icon is deliberately being redone).
//
// Same hand-painted gouache sticker style as
// scripts/generate-event-icons.mjs, but the palette here tracks tier
// progression (plain warm orange on Free, rising to a richer muted gold on
// Luxe) rather than an event mood -- these badges sit side by side on one
// pricing grid, so a shopper's eye should read "these get more premium
// left to right" the same way the copy already does.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "tier-icons");
const SIZE = 200;

const TIERS = {
  free: { bg: "#FAF7F2", accent: "#C97A3D", subject: "a simple wrapped gift box with a small bow" },
  standard: { bg: "#FDF3E7", accent: "#C97A3D", subject: "a classic vintage film camera" },
  premium: { bg: "#FBEEE0", accent: "#C9A45C", subject: "a single glowing gold five-point star with small sparkle accents around it" },
  keepsake: { bg: "#FAF8F3", accent: "#B89B5E", subject: "an ornate, gilded royal crown with small gemstones" },
};

const requested = process.argv.slice(2);
const ids = requested.length ? requested : Object.keys(TIERS);

fs.mkdirSync(outDir, { recursive: true });

for (const id of ids) {
  const spec = TIERS[id];
  if (!spec) {
    console.error(`Unknown tier "${id}" -- valid tiers: ${Object.keys(TIERS).join(", ")}`);
    continue;
  }
  const prompt = `A cute, hand-painted gouache sticker icon of ${spec.subject}, centered on a solid flat background of exactly ${spec.bg}, rendered in a warm color palette built around the accent color ${spec.accent}. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, no outline, no text, no watermark, no people.`;

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt,
    config: { imageConfig: { aspectRatio: "1:1" } },
  });
  const parts = res.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData);
  if (!imgPart) {
    console.error(`${id}: FAILED - no image returned:`, parts.find((p) => p.text)?.text?.slice(0, 200));
    continue;
  }

  const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");
  const jpegBuf = await sharp(rawBuf).resize(SIZE, SIZE, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
  const destPath = path.join(outDir, `${id}.jpg`);
  // Write-then-rename -- see the identical comment in
  // scripts/generate-invite-backgrounds.mjs for why a direct overwrite is
  // avoided here.
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, jpegBuf);
  fs.renameSync(tmpPath, destPath);
  console.log(`${id}: saved ${jpegBuf.length} bytes`);
}
