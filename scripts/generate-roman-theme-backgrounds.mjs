// One-time generator for the ancient-Roman theme's two Gemini-illustrated
// textures: public/images/mobile-bg-pillars.jpg (the mobile/tablet page
// background, app/layout.js) and public/images/marble-tablet.jpg (the
// pricing tier card background, app/page.jsx / app/booking/page.jsx).
// Same model and blind-emboss visual language as
// scripts/generate-invite-backgrounds.mjs, not run at request time --
// these are static assets, regenerated only when deliberately redoing one.
//
// pillars replaces an earlier wave-sand version of this same background
// (same file slot, same processing) -- kept as "pillars" rather than
// "sand" throughout this file since that's the name that matters going
// forward, not a record of what used to be here.
//
// Usage: node --env-file=.env.local scripts/generate-roman-theme-backgrounds.mjs [pillars] [marble]
//   No args -- regenerates both.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const OUT_DIR = path.join(process.cwd(), "public", "images");
const PAPER = { r: 0xfa, g: 0xf7, b: 0xf2 }; // #FAF7F2, the site's own paper

// Same blind-emboss language as the invite backgrounds' own STYLE_SUFFIX --
// pressed into the material itself, not printed in any ink or color, so
// this reads as the same visual family as the rest of the site's emboss
// work rather than a new, unrelated illustration style.
const STYLE_SUFFIX =
  "Photographed macro, in a single-tone blind-emboss / carved relief -- any detail is pressed into the material itself, not painted or inked, reading in the exact same soft ivory-white tone as the material around it, revealed only by soft raking studio light casting delicate, precise shadows and highlights. Extremely elegant, minimal, sophisticated. No ink, no color, no text, no people.";

const JOBS = {
  pillars: {
    // Same idea as app/page.jsx's real desktop flanking columns
    // (pillar-capital/shaft/base.jpg + entablature-tile.jpg), reframed as
    // one portrait background instead of three stacked photo slices: two
    // matching fluted columns up the left/right edges, joined at the
    // bottom by a plain stone plinth beam, with the large center left
    // bare for real page content to sit on top of.
    prompt: `A blind-emboss relief of two matching fluted Roman columns, one running the full height along the left edge of the frame and one along the right edge, mirror images of each other, each with a simple Ionic capital at the top. The two columns are joined at the very bottom of the frame by a single plain horizontal stone plinth/base beam spanning the full width between them, like the foot of a stone gate or table. The entire large center area between the two columns, at least 70% of the frame's width, stays completely bare, smooth, softly lit blank material with no carving or motif of any kind. Vertical portrait format, tall and narrow. ${STYLE_SUFFIX}`,
    aspectRatio: "9:16",
    dest: path.join(OUT_DIR, "mobile-bg-pillars.jpg"),
    // Contrast pushed around midtone after the fact -- confirmed live that
    // the raw Gemini output alone reads as too faint once it's an actual
    // page background rather than a hero-sized study, and specifically
    // that the plinth beam connecting the two columns at the very bottom
    // (the actual point of this asset) all but disappeared below ~2x.
    postGain: 2.2,
  },
  marble: {
    prompt: `A smooth polished slab of ancient Roman marble with natural subtle veining, vertical portrait format. A thin carved decorative border frame runs around the outer edge only -- a simple classical fillet-and-bead molding line about 6% of the frame's width in from each edge. The entire large center area, at least 80% of the frame, is completely bare, smooth, softly lit blank polished marble with no carving, no border detail, no motif of any kind -- reserved deliberately empty for a pricing card's own text. ${STYLE_SUFFIX}`,
    aspectRatio: "3:4",
    dest: path.join(OUT_DIR, "marble-tablet.jpg"),
    postGain: null, // used as-is: real marble veining already has enough contrast on its own
  },
};

async function generate(name, job) {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: job.prompt,
    config: { imageConfig: { aspectRatio: job.aspectRatio } },
  });
  const parts = res.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData);
  if (!imgPart) {
    console.error(`${name}: FAILED - no image returned:`, parts.find((p) => p.text)?.text?.slice(0, 300));
    return;
  }
  const rawBuf = Buffer.from(imgPart.inlineData.data, "base64");

  let outBuf;
  if (job.postGain) {
    // Re-centers contrast around midtone the same way the rest of this
    // session's emboss work does: greyscale, normalize, push contrast by
    // postGain around 128, then re-composite onto the exact paper color
    // via overlay so flat/uncarved regions stay indistinguishable from the
    // surrounding page background.
    const { data, info } = await sharp(rawBuf).greyscale().normalise().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const out = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      let v = 128 + (data[i] - 128) * job.postGain;
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
    const edgeMap = await sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
    outBuf = await sharp({ create: { width, height, channels: 3, background: PAPER } })
      .composite([{ input: edgeMap, blend: "overlay" }])
      .jpeg({ quality: 90 })
      .toBuffer();
  } else {
    // brightness 1.2 / saturation 0.55, not the invite backgrounds' own
    // 1.16 / 0.75 -- confirmed live that this specific marble's real cool
    // grey veining needed a bigger saturation cut than warm ivory
    // cardstock ever did to read as "white cream" rather than grey-veined
    // Carrara marble, the same known Gemini-brightness gap
    // lib/inviteCard.js's own comment already documents, just further
    // along it for this particular source image.
    outBuf = await sharp(rawBuf).modulate({ brightness: 1.2, saturation: 0.55 }).jpeg({ quality: 90 }).toBuffer();
  }

  // Same tmp-then-rename dance as generate-invite-backgrounds.mjs -- a
  // direct overwrite of an existing asset path intermittently fails on
  // Windows while next dev's file watcher holds it open.
  const tmpPath = `${job.dest}.tmp-${process.pid}`;
  const fs = await import("fs");
  fs.writeFileSync(tmpPath, outBuf);
  fs.renameSync(tmpPath, job.dest);
  console.log(`${name}: saved ${outBuf.length} bytes -> ${job.dest}`);
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(JOBS);

for (const name of names) {
  const job = JOBS[name];
  if (!job) {
    console.error(`Unknown job "${name}" -- valid: ${Object.keys(JOBS).join(", ")}`);
    continue;
  }
  await generate(name, job);
}
