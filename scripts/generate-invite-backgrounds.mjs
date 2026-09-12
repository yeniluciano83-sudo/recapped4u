// One-time generator for lib/assets/invite-backgrounds/<mood>.jpg (and,
// with --print, lib/assets/invite-backgrounds-print/<mood>.jpg) -- the
// real, AI-illustrated background art behind the guest invite image and
// the printed card (see lib/inviteCard.js). Not run at request time:
// these are static assets committed to the repo, generated once (or
// whenever a mood's art is deliberately being redone) and reused for
// every invite share/print after that.
//
// Usage: node --env-file=.env.local scripts/generate-invite-backgrounds.mjs [--print] [mood ...]
//   No mood args -- regenerates every mood. One or more mood keys --
//   regenerates just those (e.g. to redo a single mood's art without
//   touching the rest). --print switches to the printed card's landscape
//   shape and output directory instead of the digital invite's 9:16.
//
// Each prompt asks for an illustration with its outer border decorated
// and its center two-thirds left clear -- that clear center is where
// lib/inviteCard.js draws the event details, tagline, and QR code, so a
// redo should keep that same "framed border, clear middle" shape or the
// text will end up overlapping the artwork. The exact aspect ratio and
// orientation come from the config below, not the prompt text, so the
// same wording works for both variants.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const isPrint = process.argv.includes("--print");
const outDir = path.join(process.cwd(), "lib", "assets", isPrint ? "invite-backgrounds-print" : "invite-backgrounds");
// The printed card is a landscape flyer/table-card shape (see
// PRINT_CARD_W/PRINT_CARD_H in lib/inviteCard.js, ~1600x1080) rather than
// the digital invite's tall 9:16 phone-story shape -- "3:2" is the closest
// Gemini-supported ratio to that, and sharp's fit:"cover" step in
// buildInviteCard crops the small remainder rather than distorting it.
const aspectRatio = isPrint ? "3:2" : "9:16";
const orientationPhrase = isPrint ? "horizontal landscape format" : "vertical portrait format";

const PROMPTS = {
  romantic: `A soft, elegant watercolor illustration frame for a wedding invitation card, ${orientationPhrase}. Blush pink and dusty rose roses and delicate flowers only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank cream/blush space with no flowers, suitable for overlaying dark text. No people, no text, no calligraphy.`,
  festive: `A joyful, colorful watercolor illustration frame for a birthday party invitation card, ${orientationPhrase}. Bright orange, coral, and gold balloons and confetti scattered only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no decoration, suitable for overlaying dark text. No people, no text.`,
  professional: `An elegant, sophisticated watercolor illustration frame for a corporate event invitation card, ${orientationPhrase}. Deep navy and forest green background with a thin gold laurel wreath and geometric line border only around the outer edges of the image. The entire center two-thirds of the image is a smooth dark navy blank space with no decoration, suitable for overlaying light/gold text. No people, no text.`,
  warm: `A rustic, botanical watercolor illustration frame for a family reunion invitation card, ${orientationPhrase}. Sage green and warm olive leaf sprigs and branches only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no leaves, suitable for overlaying dark text. No people, no text.`,
  holiday: `A festive watercolor illustration frame for a holiday celebration invitation card, ${orientationPhrase}. Berry red, pine green, and gold holly, pine branches, and small ornaments only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank warm cream space with no decoration, suitable for overlaying dark text. No people, no text.`,
  reverent: `A soft, dignified watercolor illustration frame for a religious ceremony invitation card, ${orientationPhrase}, deliberately free of any single religion's specific iconography. Dove-grey and soft gold radiant light rays and delicate line flourishes only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank ivory space with no decoration, suitable for overlaying dark text. No people, no text, no religious symbols.`,
  generic: `A warm, elegant watercolor illustration frame for a general celebration invitation card, ${orientationPhrase}. Soft terracotta orange and cream abstract organic shapes and delicate botanical accents only around the outer edges of the image. The entire center two-thirds of the image is soft clear blank cream space with no decoration, suitable for overlaying dark text. No people, no text.`,
};

const requested = process.argv.slice(2).filter((a) => a !== "--print");
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
    config: { imageConfig: { aspectRatio } },
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
  const destPath = path.join(outDir, `${mood}.jpg`);
  // Write to a temp path and rename into place rather than overwriting
  // destPath directly -- confirmed live on this machine that a direct
  // fs.writeFileSync to an existing asset path here intermittently fails
  // with a Windows "UNKNOWN: unknown error" (most likely `next dev`'s own
  // file watcher briefly holding the file open), while a rename over the
  // same existing path succeeds every time.
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, jpegBuf);
  fs.renameSync(tmpPath, destPath);
  console.log(`${mood}: saved ${jpegBuf.length} bytes`);
}
