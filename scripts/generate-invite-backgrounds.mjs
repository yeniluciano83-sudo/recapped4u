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

// Each prompt names a specific fine-art/illustration tradition (gouache
// wedding stationery, art-deco gala programs, golden-hour botanical
// watercolor, paper-cut collage, etc.) rather than a generic "watercolor
// illustration" -- confirmed live that the generic version reliably
// undersold the moment (birthday became "some balloons and confetti"),
// while naming a real artistic reference point and a specific, evocative
// scene gets Gemini to actually commit to a mood instead of defaulting to
// the most obvious clip-art association for each event type.
//
// The center is asked to dissolve into a soft, out-of-focus bokeh glow --
// a real photographic/painterly device (shallow depth of field) -- rather
// than a flat, blank color fill. A first pass asked for a literal "clear
// blank space" there and it worked (lib/inviteCard.js's scrim keeps text
// legible either way) but looked static and a little empty next to how
// detailed the borders had become; a softly blurred glow of light and
// color reads as an intentional, atmospheric photograph instead of "art
// with a hole cut out of the middle," while staying just as calm behind
// text.
const PROMPTS = {
  romantic: `A cinematic, richly painted wedding invitation illustration in fine hand-painted gouache, in the tradition of luxury wedding stationery, ${orientationPhrase}. A lush archway of trailing eucalyptus, garden roses, and ranunculus in blush pink, dusty mauve, and champagne gold, rendered in sharp, richly detailed focus around the outer edges, with fine gold botanical linework and a pair of soft golden butterflies catching the light. The scene dissolves toward the center into a soft, dreamy, out-of-focus bokeh of warm blush-cream light, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark serif text. No people, no calligraphy, no text.`,
  festive: `A cinematic, high-energy editorial illustration for a birthday celebration, painted like a burst of confetti frozen mid-air with real depth and dimension, ${orientationPhrase}. Streamers, ribbon curls, gold stars, and a shower of confetti in coral, hot pink, marigold, and turquoise, rendered in sharp, richly detailed focus around the outer edges, with balloons catching dramatic light in the corners. The scene dissolves toward the center into a soft, glowing, out-of-focus bokeh of warm light, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text.`,
  professional: `A cinematic art-deco illustration for a corporate gala invitation, in the style of a luxury gala program cover, ${orientationPhrase}. A richly detailed brushed-gold geometric border -- sunburst fan lines, layered chevrons, a delicate laurel motif -- rendered in sharp focus around the outer edges over a deep navy ground, with an elegant skyline silhouette glowing along the bottom edge. The scene dissolves toward the center into a smooth, softly glowing dark navy bokeh, like a shallow depth-of-field photograph, keeping the center two-thirds calm and uncluttered, suitable for overlaying light gold text. No people, no text.`,
  warm: `A cinematic, golden-hour botanical illustration for a family reunion, painted in rich, sunlit brushwork with real depth, ${orientationPhrase}. Sun-dappled olive branches, wildflowers, sprigs of wheat, and a pair of small songbirds, rendered in sharp, richly detailed focus along the outer edges, evoking a backyard gathering at golden hour. The scene dissolves toward the center into a soft, glowing, out-of-focus bokeh of amber and honey light, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text.`,
  holiday: `A cinematic, softly-lit watercolor illustration for a holiday celebration, evoking a cozy candlelit evening with real depth and warmth, ${orientationPhrase}. Berry red and pine-green garlands strung with glowing fairy lights and gold ornaments, rendered in sharp, richly detailed focus along the outer edges, with delicate falling snow. The scene dissolves toward the center into a soft, warm, out-of-focus bokeh glow, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text.`,
  reverent: `A cinematic, luminous watercolor illustration for a religious ceremony invitation, deliberately free of any single religion's specific iconography, ${orientationPhrase}. Radiant dove-grey and soft gold light rays, rendered in richly detailed, sharp focus fanning in from the outer edges like early morning light through clouds, with delicate feather-light linework and a pair of doves in flight near the top corners. The scene dissolves toward the center into a soft, luminous, out-of-focus bokeh glow, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text, no religious symbols.`,
  generic: `A cinematic, modern illustration for a general celebration, in the style of a fine-art paper-cut collage with real dimension and shadow, ${orientationPhrase}. Soft terracotta, warm cream, and muted gold organic shapes -- overlapping arcs, leaves, and freeform curves -- rendered in sharp, richly detailed focus along the outer edges like a piece of gallery art. The scene dissolves toward the center into a soft, glowing, out-of-focus bokeh of warm cream light, like a shallow depth-of-field photograph, keeping the center two-thirds soft and uncluttered, suitable for overlaying dark text. No people, no text.`,
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
