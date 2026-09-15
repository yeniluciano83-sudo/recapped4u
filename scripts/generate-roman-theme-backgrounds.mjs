// One-time generator for the ancient-Roman theme's two Gemini-illustrated
// textures: public/images/mobile-bg-sand.jpg (the mobile/tablet page
// background, app/layout.js) and public/images/marble-tablet.jpg (the
// pricing tier card background, app/page.jsx / app/booking/page.jsx).
// Same model and blind-emboss visual language as
// scripts/generate-invite-backgrounds.mjs, not run at request time --
// these are static assets, regenerated only when deliberately redoing one.
//
// Usage: node --env-file=.env.local scripts/generate-roman-theme-backgrounds.mjs [sand] [marble]
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
  sand: {
    prompt: `A blind-emboss relief of wave-washed beach sand ripples -- the uneven, organic parallel ridges left in wet sand as an ocean wave recedes -- covering the entire frame edge to edge at a macro, top-down angle, vertical portrait format. ${STYLE_SUFFIX}`,
    aspectRatio: "9:16",
    dest: path.join(OUT_DIR, "mobile-bg-sand.jpg"),
    // Contrast pushed around midtone after the fact -- confirmed live
    // (this session) that the raw Gemini output alone reads as too faint
    // once it's an actual page background rather than a hero-sized study.
    postGain: 1.6,
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
    outBuf = await sharp(rawBuf).modulate({ brightness: 1.1, saturation: 0.9 }).jpeg({ quality: 90 }).toBuffer();
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
