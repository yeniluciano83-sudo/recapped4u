// One-time generator for public/images/host-page-icons/<slug>.jpg -- a
// small, square "sticker" icon for the host QR/share page (app/qr/[slug]
// /page.jsx), replacing the plain lucide Camera glyph used in the "Add
// your own photos" card badge and the two "No photos uploaded yet" empty
// states (same concept, reused at different sizes) rather than three
// separate icons for the same idea. Not run at request time: a static
// asset committed to the repo, generated once (or whenever it's
// deliberately being redone).
//
// A retro instant camera rather than the plain lucide camera glyph, and
// deliberately not the same vintage-camera art already used for the
// Highlight pricing tier (public/images/tier-icons/standard.jpg) -- reusing
// that here would tie this page's own "add your own photos" action to a
// specific pricing tier's identity, which isn't what it means in this
// context.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "host-page-icons");
const SIZE = 160;

const ICONS = {
  "add-own-photos": "a retro instant camera with a photo print sliding out of the front of it",
};

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(ICONS);

fs.mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const subject = ICONS[slug];
  if (!subject) {
    console.error(`Unknown host-page icon slug "${slug}" -- valid slugs: ${Object.keys(ICONS).join(", ")}`);
    continue;
  }
  const prompt = `A cute, hand-painted gouache sticker icon of ${subject}, centered on a solid flat cream background, rendered in a warm color palette built around a terracotta-orange accent. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, absolutely no text or lettering of any kind anywhere in the image, no outline, no watermark, no people.`;

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
