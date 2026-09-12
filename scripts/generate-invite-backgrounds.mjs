// One-time generator for lib/assets/invite-backgrounds/<mood>.jpg -- the
// real, AI-illustrated background art behind the guest invite image (see
// lib/inviteCard.js). Not run at request time: these are static assets
// committed to the repo, generated once (or whenever a mood's art is
// deliberately being redone) and reused for every invite share after that.
//
// Usage: node --env-file=.env.local scripts/generate-invite-backgrounds.mjs [mood ...]
//   No args -- regenerates every mood. One or more mood keys -- regenerates
//   just those (e.g. to redo a single mood's art without touching the rest).
//
// Each prompt asks for a 9:16 vertical illustration with its outer border
// decorated and its center two-thirds left clear -- that clear center is
// where lib/inviteCard.js draws the event details, tagline, and QR code,
// so a redo should keep that same "framed border, clear middle" shape or
// the text will end up overlapping the artwork.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "lib", "assets", "invite-backgrounds");

const PROMPTS = {
  romantic: "A soft, elegant watercolor illustration frame for a wedding invitation card, vertical portrait format. Blush pink and dusty rose roses and delicate flowers only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank cream/blush space with no flowers, suitable for overlaying dark text. No people, no text, no calligraphy.",
  festive: "A joyful, colorful watercolor illustration frame for a birthday party invitation card, vertical portrait format. Bright orange, coral, and gold balloons and confetti scattered only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no decoration, suitable for overlaying dark text. No people, no text.",
  professional: "An elegant, sophisticated watercolor illustration frame for a corporate event invitation card, vertical portrait format. Deep navy and forest green background with a thin gold laurel wreath and geometric line border only around the outer edges of the image. The entire center two-thirds of the image is a smooth dark navy blank space with no decoration, suitable for overlaying light/gold text. No people, no text.",
  warm: "A rustic, botanical watercolor illustration frame for a family reunion invitation card, vertical portrait format. Sage green and warm olive leaf sprigs and branches only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no leaves, suitable for overlaying dark text. No people, no text.",
  holiday: "A festive watercolor illustration frame for a holiday celebration invitation card, vertical portrait format. Berry red, pine green, and gold holly, pine branches, and small ornaments only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no decoration, suitable for overlaying dark text. No people, no text.",
  reverent: "A soft, dignified watercolor illustration frame for a religious ceremony invitation card, vertical portrait format, deliberately free of any single religion's specific iconography. Dove-grey and soft gold radiant light rays and delicate line flourishes only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank ivory space with no decoration, suitable for overlaying dark text. No people, no text, no religious symbols.",
  generic: "A warm, elegant watercolor illustration frame for a general celebration invitation card, vertical portrait format. Soft terracotta orange and cream abstract organic shapes and delicate botanical accents only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank cream space with no decoration, suitable for overlaying dark text. No people, no text.",
};

const requested = process.argv.slice(2);
const moods = requested.length ? requested : Object.keys(PROMPTS);

fs.mkdirSync(outDir, { recursive: true });

for (const mood of moods) {
  const prompt = PROMPTS[mood];
  if (!prompt) {
    console.error(`Unknown mood "${mood}" -- valid moods: ${Object.keys(PROMPTS).join(", ")}`);
    continue;
  }
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: prompt,
    config: { imageConfig: { aspectRatio: "9:16" } },
  });
  const parts = res.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData);
  if (!imgPart) {
    console.error(`${mood}: FAILED - no image returned:`, parts.find((p) => p.text)?.text?.slice(0, 200));
    continue;
  }
  // Re-encoded to JPEG quality 95 -- Gemini returns PNG, but this is a
  // photographic watercolor image (not flat vector art), so PNG's
  // lossless compression makes it 5-7x larger for no visible difference.
  // lib/inviteCard.js re-encodes to JPEG again at the final composite
  // step regardless, so keeping the master this way avoids storing a much
  // larger file that only ever gets read, resized, and re-compressed.
  const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");
  const jpegBuf = await sharp(rawBuf).jpeg({ quality: 95 }).toBuffer();
  fs.writeFileSync(path.join(outDir, `${mood}.jpg`), jpegBuf);
  console.log(`${mood}: saved ${jpegBuf.length} bytes`);
}
