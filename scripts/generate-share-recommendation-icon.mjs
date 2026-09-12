// One-time generator for public/images/host-page-icons/recommended-share.jpg
// -- a small "sticker" icon marking Text/WhatsApp as the recommended way to
// share the digital invite from the host's QR page (app/qr/[slug]/page.jsx).
// Not run at request time: a static asset committed to the repo, generated
// once (or whenever it's deliberately being redone).
//
// Same hand-painted gouache sticker style and neutral brand palette as
// scripts/generate-faq-icons.mjs.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "host-page-icons");
const SIZE = 160;

const subject = "a modern rectangular smartphone with a clearly rounded-rectangle screen, and a speech bubble with a small heart floating beside it, as if a text message just landed";

const prompt = `A cute, hand-painted gouache sticker icon of ${subject}, centered on a solid flat cream background, rendered in a warm color palette built around a terracotta-orange accent. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, absolutely no text or lettering of any kind anywhere in the image, no outline, no watermark, no people.`;

fs.mkdirSync(outDir, { recursive: true });

const res = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: prompt,
  config: { imageConfig: { aspectRatio: "1:1" } },
});
const parts = res.candidates?.[0]?.content?.parts || [];
const imgPart = parts.find((p) => p.inlineData);
if (!imgPart) {
  console.error("FAILED - no image returned:", parts.find((p) => p.text)?.text?.slice(0, 200));
  process.exit(1);
}

const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");
const jpegBuf = await sharp(rawBuf).resize(SIZE, SIZE, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
const destPath = path.join(outDir, "recommended-share.jpg");
// Write-then-rename -- see the identical comment in
// scripts/generate-invite-backgrounds.mjs for why a direct overwrite is
// avoided here.
const tmpPath = `${destPath}.tmp-${process.pid}`;
fs.writeFileSync(tmpPath, jpegBuf);
fs.renameSync(tmpPath, destPath);
console.log(`saved ${jpegBuf.length} bytes`);
