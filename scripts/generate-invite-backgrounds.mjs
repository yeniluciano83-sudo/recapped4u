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

// All seven moods now render as a 3D scene instead of the flat painterly
// gouache used before -- but the flavor of "3D" splits in two. The five
// more playful/personal occasions (romantic, festive, warm, holiday,
// generic) get a cute glossy clay-render look, like a modern Pixar-short
// still. Corporate and religious ceremony keep the same dimensionality
// but in a more restrained register -- polished metallic/glass materials
// and dramatic studio lighting, nothing "cute" -- since a gala or a
// ceremony invitation calling for genuine formality. The card's own copy
// stays split the same way (see NON_ITALIC_MOODS in lib/inviteCard.js,
// which this file's comments call out by hand to keep in sync): only
// professional and reverent keep upright, formal type -- the other five
// go italic. Art style and type style move independently on this split;
// only professional/reverent are excluded from italics, not from 3D.
//
// Every prompt ends with the same QUALITY_SUFFIX (4K/cinematic color grade
// language) rather than repeating it per mood, and imageConfig.imageSize
// actually requests 4K generation -- confirmed live that without it the
// API defaults to "1K" (768x1344 for 9:16), which meant every card was
// quietly upscaling a sub-1080px master to fill its own 1080x1920 canvas.
//
// Each scene mixes at least three distinct kinds of object rather than
// one motif repeated (e.g. romantic isn't "just roses" -- it's flowers
// plus a ribbon plus butterflies plus candlelight), and asks explicitly
// for elegance/restraint on top of density -- confirmed live that "dense"
// alone can read as cluttered without also asking for a curated,
// gallery-quality arrangement rather than a pile of the same object.
const QUALITY_SUFFIX = "Ultra-detailed 4K render, rich cinematic color grading, vivid saturated colors, crisp sharp detail throughout, professional studio-quality lighting, elegant and tasteful curated composition -- a refined arrangement of varied elements, not one motif repeated.";
const PROMPTS = {
  romantic: `A dreamy, softly-lit 3D rendered scene of an elegant floral wedding archway, in a cute glossy clay-render style (like a modern Pixar short), warm studio lighting and soft shadows, ${orientationPhrase}. A refined mix of layered garden roses, ranunculus, and peonies in blush, ivory, and champagne, trailing eucalyptus, a delicate satin ribbon bow, a scattering of small pearls, and a pair of glossy 3D butterflies catching the light -- a curated, proper wedding-invitation-quality arrangement, densely filling only the outer edges in sharp, richly detailed 3D render. The scene dissolves toward the center into a soft, dreamy, out-of-focus blush-cream glow, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark serif text. No people, no calligraphy, no text. ${QUALITY_SUFFIX}`,
  festive: `A vibrant 3D rendered scene of an elegant birthday celebration, in a cute glossy clay-render style (like a modern Pixar short), warm studio lighting and soft shadows, ${orientationPhrase}. A curated mix of glossy 3D balloons, ribbon curls, a shower of confetti in coral, hot pink, marigold, and turquoise, a small wrapped gift box with a bow, and a lit birthday candle -- densely framing only the outer edges in sharp, richly detailed 3D render, with real sense of motion and energy. The scene dissolves toward the center into a soft, glowing, out-of-focus warm light, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text. ${QUALITY_SUFFIX}`,
  professional: `A sleek, sophisticated 3D rendered scene for a corporate gala invitation, in the style of a luxury architectural render, ${orientationPhrase}. An ornate, richly detailed polished brushed-gold geometric frame with glossy 3D sunburst fan lines, layered chevrons, a delicate laurel motif, a crystal champagne coupe, and a fine fountain pen, rendered with realistic metallic and glass materials and dramatic studio lighting over a deep navy ground. An elegant 3D skyline silhouette glows along the bottom edge. The scene dissolves toward the center into a smooth, softly glowing dark navy glow, keeping the center two-thirds calm and uncluttered, suitable for overlaying light gold text. No people, no text. ${QUALITY_SUFFIX}`,
  warm: `A warm, golden-hour 3D rendered scene of an elegant picnic gathering, in a cute glossy clay-render style (like a modern Pixar short), warm studio lighting and soft shadows, ${orientationPhrase}. A curated mix of glossy 3D olive branches, wildflowers, sprigs of wheat, a woven picnic basket, a mason jar of lemonade, and a soft woven blanket -- densely framing only the outer edges in sharp, richly detailed 3D render, evoking a backyard gathering at golden hour. The scene dissolves toward the center into a soft, glowing, out-of-focus amber light, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text. ${QUALITY_SUFFIX}`,
  holiday: `A cozy 3D rendered scene of an elegant holiday garland, in a cute glossy clay-render style (like a modern Pixar short), warm studio lighting and soft shadows, ${orientationPhrase}. A curated mix of glossy 3D pine branches, string lights, gold ornaments in berry red and pine green, a wrapped gift box with a ribbon, a pinecone, and a scattering of glossy 3D snowflakes -- densely framing only the outer edges in sharp, richly detailed 3D render. The scene dissolves toward the center into a soft, warm, out-of-focus glow, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text. ${QUALITY_SUFFIX}`,
  reverent: `A soft, luminous 3D rendered scene for a religious ceremony invitation, deliberately free of any single religion's specific iconography, in an elegant glossy 3D render style with soft studio lighting, ${orientationPhrase}. A curated mix of radiant dove-grey and soft gold 3D light rays fanning gently in from the outer edges like early morning light through clouds, delicate glossy 3D feather shapes, a pair of doves in flight near the top corners, and a single softly glowing candle. The scene dissolves toward the center into a soft, luminous, out-of-focus glow, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text, no religious symbols. ${QUALITY_SUFFIX}`,
  generic: `An elegant 3D rendered scene of curated abstract organic shapes, in a cute glossy clay-render style (like a modern Pixar short), warm studio lighting and soft shadows, ${orientationPhrase}. A refined mix of glossy 3D arcs, leaf forms, freeform curves, a delicate ribbon, and a small gift box in terracotta, cream, and muted gold, densely framing only the outer edges in sharp, richly detailed 3D render like a piece of gallery art. The scene dissolves toward the center into a soft, glowing, out-of-focus cream light, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text. ${QUALITY_SUFFIX}`,
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
  // imageConfig.imageSize ("1K"/"2K"/"4K", per the SDK's own ImageConfig
  // type) is NOT actually honored by gemini-2.5-flash-image -- confirmed
  // live, passing "4K" returns the exact same 768x1344 pixels as "1K" for
  // this same 9:16 shape. That field only applies to Google's separate
  // Imagen models, which need Vertex AI -- the same reason this script
  // uses generateContent instead of generateImages() at all (see git
  // history/PR notes). Deliberately not passed here, so a future reader
  // doesn't assume it's doing something it isn't; real resolution headroom
  // would need an Imagen/Vertex integration, not a config tweak here.
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
