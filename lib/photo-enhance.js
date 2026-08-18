
/**
 * Automated photo enhancement — no human editing step.
 *
 * This performs real, deterministic image processing:
 *  - Auto-rotate based on EXIF orientation
 *  - Per-photo adaptive exposure/contrast correction (reads each photo's
 *    actual histogram and corrects individually, rather than applying one
 *    flat adjustment to every photo regardless of how dark/bright it is)
 *  - Mild noise reduction on high-ISO / low-light shots
 *  - Saturation boost tuned per style (cinematic/upbeat/documentary/retro/highlight)
 *  - Adaptive sharpening (lighter on noisy photos, stronger on clean ones)
 *  - Resize to a consistent max dimension for fast web delivery
 *
 * This does NOT generate or alter image content — every pixel is still
 * the guest's real photo, just processed the way a skilled photo editor's
 * per-image "auto enhance" would (analyzing each photo individually).
 */

const sharp = require("sharp");

const STYLE_ADJUSTMENTS = {
  cinematic: { saturation: 0.9, gamma: 1.05 },   // slightly desaturated, warm
  upbeat: { saturation: 1.25, gamma: 1.0 },      // punchy, vivid
  documentary: { saturation: 1.0, gamma: 1.0 },  // true to life, minimal
  retro: { saturation: 0.75, gamma: 1.1 },       // vintage, warm fade -- sharp's gamma() only
                                                  // accepts 1.0-3.0 (a value <1 would actually
                                                  // darken the image, the opposite of a faded
                                                  // look); a slight lift above 1.0 gives the
                                                  // washed-out midtones a vintage fade needs
  highlight: { saturation: 1.3, gamma: 1.0 },    // bold, high energy
};

async function enhancePhoto(inputBuffer, style = "documentary") {
  const adjustments = STYLE_ADJUSTMENTS[style] || STYLE_ADJUSTMENTS.documentary;

  const image = sharp(inputBuffer).rotate(); // auto-orient based on EXIF first
  const rotatedBuffer = await image.toBuffer();

  // Analyze this specific photo's actual exposure and noise level
  const stats = await sharp(rotatedBuffer).stats();
  const { mean, stdev } = averageChannelStats(stats);

  // Decide per-photo brightness correction based on where this photo's
  // actual mean brightness sits (0-255 scale). Target a mid-gray-ish mean
  // rather than blindly normalizing every photo the same way.
  const targetMean = 128;
  const brightnessDelta = targetMean - mean;
  // Cap correction strength so we don't overcorrect intentionally dark/moody shots
  const brightnessFactor = clamp(1 + brightnessDelta / 255, 0.85, 1.25);

  // Low stdev = flat/washed-out photo that needs more contrast; high stdev =
  // already has good contrast, needs less normalization push
  const needsContrastBoost = stdev < 40;

  // Noisy/grainy photos (common in low light) get lighter sharpening and
  // a denoise pass; clean photos get fuller sharpening
  const isLowLight = mean < 70;

  let pipeline = sharp(rotatedBuffer);

  if (needsContrastBoost) {
    pipeline = pipeline.normalize(); // stretch contrast only when the photo actually needs it
  }

  if (isLowLight) {
    pipeline = pipeline.median(3); // mild denoise for grainy low-light shots
  }

  const enhanced = await pipeline
    .modulate({
      saturation: adjustments.saturation,
      brightness: brightnessFactor,
    })
    .gamma(adjustments.gamma)
    .sharpen({ sigma: isLowLight ? 0.5 : 0.9 })
    .resize({ width: 3840, height: 3840, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  return enhanced;
}

function averageChannelStats(stats) {
  const channels = stats.channels;
  const mean = channels.reduce((sum, c) => sum + c.mean, 0) / channels.length;
  const stdev = channels.reduce((sum, c) => sum + c.stdev, 0) / channels.length;
  return { mean, stdev };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { enhancePhoto };