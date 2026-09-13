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
// Each prompt confines its motif to a thin strip along one edge (left for
// the digital 9:16 card, bottom for the print 3:2 card -- see marginPhrase
// below), matching the one edge lib/inviteCard.js's own text scrim and QR
// box structurally never reach into, whatever the copy length. A redo
// should keep pointing at that same edge or the text/QR will start
// overlapping the artwork again. The exact aspect ratio and orientation
// come from the config below, not the prompt text, so the same wording
// works for both variants.
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

// Every mood now shares one visual language: a smooth creamy-white
// cardstock background with a single small blind-emboss motif -- pressed
// into the paper itself, not printed in color, so it reads in the paper's
// own tone and is revealed only by soft raking light and shadow. Replaces
// an earlier, louder pass at colorful 3D clay-render scenes (one per
// mood, richly saturated, several objects each) -- simple, tonal, and
// restrained reads as more elegant for a keepsake invitation than a busy
// colorful illustration, and it also means every mood can share the exact
// same creamy base rather than each getting its own background color, with
// the one spot of real color left for `accent`/`text` in lib/inviteMoods.js
// (the event details themselves) to carry the personality instead.
//
// Deliberately one or two objects per scene, not several -- the "elegant,
// diversify" pass that preceded this style asked for denser, multi-object
// compositions, which suited saturated color but reads as clutter once
// everything is a single tone; restraint is the whole point of an emboss.
const STYLE_SUFFIX = "Photographed macro on smooth creamy ivory cardstock paper, in a single-tone blind-emboss / letterpress relief -- the shapes are pressed into the paper itself, not printed in any ink or color, so every raised element reads in the exact same soft ivory-white tone as the paper around it, revealed only by soft raking studio light casting delicate, precise shadows and highlights along each raised edge. Extremely elegant, minimal, and sophisticated, like a luxury stationer's foil-free emboss. No ink, no color, no text, no people, no religious symbols.";
// "Gathered in one corner" (an earlier pass's wording) still let Gemini
// render a motif large enough to run behind the QR code and the text
// scrim -- confirmed live on a real card. A single thin edge strip (the
// pass after that) fixed the overlap but read as a lot of bare, unused
// cardstock above and below the card and QR -- confirmed live, then
// confirmed against lib/inviteCard.js's own layout math: the digital
// card's content column (text scrim + centered QR box) always stays
// within its own left/right padding AND leaves real top/bottom margin
// once that column is vertically centered, so the safe area is actually
// an open three-sided border (left, top, and bottom), not just one edge
// -- deliberately left open on the right for an asymmetric, picture-
// frame-with-one-side-missing look rather than a fully boxed-in border.
// The print card's own safe area is the same three sides, just
// proportioned differently: its content spans nearly the full width (a
// text column plus a QR column), so its left band has to stay thin, while
// vertical centering leaves real room top and bottom.
//
// A single continuous border (the pass after that) fixed the coverage
// complaint but pushed Gemini toward an abstract repeating lace/vine
// pattern instead of the actual named objects in each mood's own prompt
// (a rose, a bow, doves) -- confirmed live, the border read as generic
// scrollwork instead of anything you could name. Two separate, large,
// clearly-detailed corner clusters (rather than one thin motif smeared
// along the whole edge) is what got real recognizable relief detail back
// while still keeping both clusters inside the same safe corners.
// "Optionally linked by a thin line" (the pass after that) was meant to
// read as a hairline stem, but Gemini consistently rendered it as a
// full-height ruled line running the entire left edge -- confirmed live,
// it looked like a stray printing artifact rather than a design choice.
// Explicitly ruling it out (not just leaving it "optional") is what
// actually stopped it from appearing.
const marginPhrase = isPrint
  ? "positioned as two separate, clearly detailed clusters of these objects -- rendered large enough to show real, crisp relief detail (individual petals, ribbon folds, feather barbs, icing texture, etc, whichever apply), not simplified into a repeating abstract pattern. One cluster sits in the top-left corner of the frame and the other in the bottom-left corner, each confined within roughly the outer 20% of the frame's height and 10% of its width at that corner. The two clusters are NOT connected by any line, vine, stem, or other element of any kind -- the space between them stays completely bare. The entire remaining frame -- the large center and right portion -- must stay completely bare, smooth, softly lit blank cardstock with no motif, texture, or design of any kind"
  : "positioned as two separate, clearly detailed clusters of these objects -- rendered large enough to show real, crisp relief detail (individual petals, ribbon folds, feather barbs, icing texture, etc, whichever apply), not simplified into a repeating abstract pattern. One cluster sits in the top-left corner of the frame and the other in the bottom-left corner, each confined within roughly the outer 15% of the frame's width and 12% of its height at that corner. The two clusters are NOT connected by any line, vine, stem, or other element of any kind -- the space between them stays completely bare. The entire remaining frame -- the large center and right portion -- must stay completely bare, smooth, softly lit blank cardstock with no motif, texture, or design of any kind";
const PROMPTS = {
  romantic: `A blind-emboss relief of a single delicate garden rose in full bloom, a neatly tied ribbon bow, and a pair of doves in flight, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  // Birthday reads as "someone's big day" -- a cake, not a generic party.
  birthday: `A blind-emboss relief of a small cluster of round balloons floating beside a simple tiered celebration cake with lit candles, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  // The other half of the old "festive" mood -- Party itself plus
  // retirement/graduation/bachelor(ette) occasions with no specific
  // milestone object of their own. Graffiti gives it a distinct, more
  // playful/urban identity from birthday's cake.
  party: `A blind-emboss relief of a small cluster of round balloons beside a playful abstract graffiti-style paint-drip splash, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  professional: `A blind-emboss relief of a fine geometric sunburst frame beside a single delicate laurel sprig, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  warm: `A blind-emboss relief of a single olive branch sprig beside a small woven picnic basket, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  holiday: `A blind-emboss relief of a single pine branch sprig beside a small wrapped gift box tied with a ribbon, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  reverent: `A blind-emboss relief of a pair of doves in flight beside a soft radiating sunburst of light rays, deliberately free of any single religion's specific iconography, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
  generic: `A blind-emboss relief of a small cluster of soft abstract organic arcs beside a delicate ribbon, pressed into smooth creamy cardstock, ${orientationPhrase}. The motif is ${marginPhrase}. ${STYLE_SUFFIX}`,
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
