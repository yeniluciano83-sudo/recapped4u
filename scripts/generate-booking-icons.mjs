// One-time generator for public/images/booking-icons/<slug>.jpg -- small,
// square "sticker" icons for the two booking-flow concepts that don't
// already have a matching icon elsewhere on the site (see app/booking
// /page.jsx). "Tell us about the event" reuses public/images/how-it-works
// -icons/book.jpg, "Pick your editing style" reuses .../editing.jpg, and
// the Roast Reel toggle reuses public/images/faq-icons/roast-reel.jpg --
// same concepts already illustrated elsewhere, not redrawn a second time.
// Not run at request time: static assets committed to the repo, generated
// once (or whenever an icon's art is deliberately being redone).
//
// Same hand-painted gouache sticker style and neutral brand palette as
// scripts/generate-faq-icons.mjs.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "booking-icons");
const SIZE = 160;

const ICONS = {
  "choose-package": "a neatly wrapped gift box with a gift tag and a satin ribbon bow, ready to hand over",
  "review-booking": "a clipboard holding a checklist with one item checked off, and a small magnifying glass beside it",
};

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(ICONS);

fs.mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const subject = ICONS[slug];
  if (!subject) {
    console.error(`Unknown booking icon slug "${slug}" -- valid slugs: ${Object.keys(ICONS).join(", ")}`);
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
