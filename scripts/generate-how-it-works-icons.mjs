// One-time generator for public/images/how-it-works-icons/<slug>.jpg --
// small, square "sticker" icons shown at each node of the homepage's "How
// It Works" timeline (app/page.jsx), replacing the flat gradient circle +
// white lucide glyph that sat there before. Not run at request time:
// static assets committed to the repo, generated once (or whenever an
// icon's art is deliberately being redone).
//
// Same hand-painted gouache sticker style and neutral brand palette as
// scripts/generate-faq-icons.mjs -- these four sit in one linear timeline,
// not a themed grid, so one consistent palette reads as a single journey
// rather than four unrelated moments.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "how-it-works-icons");
const SIZE = 160;

// One entry per step in app/page.jsx's How It Works timeline, in order.
const ICONS = {
  book: "an open calendar page with a small checkmark stamped on today's date",
  "pitch-in": "a QR code square with a small photo print peeking out from behind it",
  editing: "a magic wand with sparkling stars gently touching a photo print",
  delivered: "an open envelope with a small video play button and a couple of photo prints spilling out of it",
};

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(ICONS);

fs.mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const subject = ICONS[slug];
  if (!subject) {
    console.error(`Unknown How It Works icon slug "${slug}" -- valid slugs: ${Object.keys(ICONS).join(", ")}`);
    continue;
  }
  const prompt = `A cute, hand-painted gouache sticker icon of ${subject}, centered on a solid flat cream background, rendered in a warm color palette built around a terracotta-orange accent. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, absolutely no text or lettering of any kind anywhere in the image (including inside any QR-code-like pattern -- keep it purely a decorative grid of squares, not a scannable or readable code), no outline, no watermark, no people.`;

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
