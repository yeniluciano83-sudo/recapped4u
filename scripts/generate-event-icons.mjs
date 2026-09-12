// One-time generator for public/images/event-icons/<slug>.jpg -- small,
// square "sticker" icons shown next to each event type on the homepage's
// "Events We Cover" section (app/page.jsx's EVENT_TYPE_GROUPS), replacing
// the plain emoji that sat there before. Not run at request time: these are
// static assets committed to the repo, generated once (or whenever an
// icon's art is deliberately being redone) and reused after that.
//
// Each icon's background/accent color matches the same mood palette used
// for that event type's digital invite (see INVITE_MOODS in
// lib/inviteMoods.js) -- ties the homepage back to the same visual language
// the invite cards already established, rather than inventing a sixth
// unrelated color story.
//
// Usage: node --env-file=.env.local scripts/generate-event-icons.mjs [slug ...]
//   No args -- regenerates every icon. One or more slugs -- regenerates
//   just those.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const outDir = path.join(process.cwd(), "public", "images", "event-icons");
const SIZE = 240;

// bg/accent pulled directly from INVITE_MOODS in lib/inviteMoods.js, keyed
// by the same mood each event type already resolves to for its invite.
const MOOD_COLORS = {
  romantic: { bg: "#FBF3F0", accent: "#B8697A" },
  festive: { bg: "#FDF3E7", accent: "#C97A3D" },
  professional: { bg: "#EDE6D6", accent: "#C9A45C" },
  warm: { bg: "#F3F6EF", accent: "#7A8B76" },
  holiday: { bg: "#FBF6EC", accent: "#8B3A3A" },
  reverent: { bg: "#FAF8F3", accent: "#B89B5E" },
  generic: { bg: "#FAF7F2", accent: "#C97A3D" },
};

// One entry per pill in app/page.jsx's EVENT_TYPE_GROUPS, plus the "Ask Us"
// pill. `subject` is deliberately an object/scene, never a person -- a
// recognizable face rendered this small reads as uncanny rather than cute,
// and isn't needed to convey "wedding" or "reunion" anyway.
const ICONS = {
  weddings: { mood: "romantic", subject: "two elegant wedding rings entwined with a delicate sprig of eucalyptus" },
  "engagement-parties": { mood: "romantic", subject: "a small hand-tied bouquet of roses and ranunculus" },
  "bridal-showers": { mood: "romantic", subject: "a wrapped gift box with an elegant satin ribbon bow" },
  "bachelor-bachelorette-parties": { mood: "festive", subject: "a party sash and a bursting confetti popper" },
  graduations: { mood: "festive", subject: "a graduation cap with its tassel flipped, mid-toss" },
  anniversaries: { mood: "romantic", subject: "two champagne coupes clinking together with small sparkles" },
  "retirement-parties": { mood: "festive", subject: "a pair of clinking champagne glasses with gold confetti" },
  parties: { mood: "festive", subject: "a bursting confetti popper with streamers" },
  birthdays: { mood: "festive", subject: "a two-tier birthday cake with lit candles" },
  "sweet-16-quinceaneras": { mood: "festive", subject: "an elegant jeweled tiara" },
  "gender-reveals": { mood: "festive", subject: "two balloons, one soft pink and one soft blue, tied together" },
  "baby-showers": { mood: "warm", subject: "a baby bottle and a small rattle beside soft baby blocks" },
  "family-reunions": { mood: "warm", subject: "a woven picnic basket on a checkered blanket with wildflowers" },
  "class-friend-reunions": { mood: "warm", subject: "two hands mid-handshake with a small burst of warmth around them" },
  housewarmings: { mood: "warm", subject: "a cozy little house with a wreath on the door and warm light in the window" },
  "religious-ceremonies": { mood: "reverent", subject: "a single lit candle beside a dove in flight, softly glowing", noReligiousSymbols: true },
  "holiday-celebrations": { mood: "holiday", subject: "a string of glowing fairy lights wrapped around a pine sprig and a gold ornament" },
  "corporate-events": { mood: "professional", subject: "an elegant leather briefcase beside a steaming coffee cup" },
  "fundraisers-galas": { mood: "professional", subject: "an elegant bow tie beside a gold ribbon award" },
  vacations: { mood: "warm", subject: "a sun, a palm leaf, and a pair of sunglasses" },
  "ask-us": { mood: "generic", subject: "a friendly speech bubble with a small heart inside" },
};

const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(ICONS);

fs.mkdirSync(outDir, { recursive: true });

for (const slug of slugs) {
  const spec = ICONS[slug];
  if (!spec) {
    console.error(`Unknown icon slug "${slug}" -- valid slugs: ${Object.keys(ICONS).join(", ")}`);
    continue;
  }
  const { bg, accent } = MOOD_COLORS[spec.mood];
  const prompt = `A cute, hand-painted gouache sticker icon of ${spec.subject}, centered on a solid flat background of exactly ${bg}, rendered in a warm color palette built around the accent color ${accent}. Simple, iconic, and clean like a small illustrated badge -- soft rounded shapes, a gentle drop shadow beneath the subject, no outline, no text, no watermark, no people's faces${spec.noReligiousSymbols ? ", deliberately free of any single religion's specific iconography" : ""}.`;

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
  // Write-then-rename, not a direct overwrite -- see the identical comment
  // in scripts/generate-invite-backgrounds.mjs for why (a direct write to
  // an existing asset path here intermittently failed with a Windows
  // "UNKNOWN: unknown error" while `next dev`'s file watcher was running).
  const tmpPath = `${destPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, jpegBuf);
  fs.renameSync(tmpPath, destPath);
  console.log(`${slug}: saved ${jpegBuf.length} bytes`);
}
