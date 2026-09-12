// One-time generator for public/images/faq-icons/<slug>.jpg -- small,
// square "sticker" icons shown next to each question in the homepage's FAQ
// accordion (app/page.jsx's FAQS), replacing the plain "01", "02"... index
// number that sat there before. Not run at request time: static assets
// committed to the repo, generated once (or whenever an icon's art is
// deliberately being redone).
//
// Same hand-painted gouache sticker style as scripts/generate-event-icons.mjs
// and scripts/generate-tier-icons.mjs, but on one shared neutral palette
// (the site's own brand cream/orange, see tone.cream/tone.clay in
// components/ui.jsx) rather than per-mood or per-tier colors -- these sit
// in a single vertical list, not side by side in a themed grid, so a
// consistent palette reads as "one FAQ list" rather than a scattered set.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "faq-icons");
const SIZE = 160;
const BG = "#FAF7F2";
const ACCENT = "#C97A3D";

// One entry per question in app/page.jsx's FAQS, in the same order.
const ICONS = {
  "whats-included": "a small stack of photo prints fanned out in front of a film reel",
  "privacy": "a padlock with a small heart engraved on it",
  "turnaround": "a pocket watch with small motion lines showing it ticking",
  "retention": "a calendar page with a small photo pinned to the corner",
  "no-app": "a smartphone displaying a QR code on its screen",
  "rsvp": "an envelope with a checkmark on the front",
  "guest-limit": "a fanned-out stack of many photos",
  "cancel-reschedule": "a calendar page with a curved arrow looping around it",
  "payment": "a credit card with a small padlock icon on it",
  "pick-photos": "a single photo print with a gold star sticker on its corner",
  "editing-styles": "an artist's paint palette with a small film strip laid across it",
  "social-cut": "a smartphone playing a vertical video with a play button on screen",
  "roast-reel": "a small playful flame with a single comedic spark beside it",
};

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(ICONS);

fs.mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const subject = ICONS[slug];
  if (!subject) {
    console.error(`Unknown FAQ icon slug "${slug}" -- valid slugs: ${Object.keys(ICONS).join(", ")}`);
    continue;
  }
  const prompt = `A cute, hand-painted gouache sticker icon of ${subject}, centered on a solid flat background of exactly ${BG}, rendered in a warm color palette built around the accent color ${ACCENT}. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, no outline, no text, no watermark, no people.`;

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt,
    config: { imageConfig: { aspectRatio: "1:1" } },
  });
  const parts = res.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData);
  if (!imgPart) {
    console.error(`${slug}: FAILED - no image returned:`, parts.find((p) => p.text)?.text?.slice(0, 200));
    continue;
  }

  const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");
  const jpegBuf = await sharp(rawBuf).resize(SIZE, SIZE, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
  const destPath = path.join(outDir, `${slug}.jpg`);
  // Write-then-rename -- see the identical comment in
  // scripts/generate-invite-backgrounds.mjs for why a direct overwrite is
  // avoided here.
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, jpegBuf);
  fs.renameSync(tmpPath, destPath);
  console.log(`${slug}: saved ${jpegBuf.length} bytes`);
}
