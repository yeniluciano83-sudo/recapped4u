/**
 * Builds the blurred backdrop for the closing outro card appended after the
 * last real photo in every rendered video (full cut and social cuts alike)
 * -- see outroOverlayText/buildOverlayLines in scripts/auto-recap.js.
 *
 * Reuses the last shortlisted photo as its own background, same idea as
 * the blurred/dimmed letterbox fill lib/video-assemble.js now gives every
 * photo. Deliberately produces an image with NO text baked in -- the
 * sign-off line is burned on afterward via the same overlayLines/drawtext
 * path every other on-screen text in this pipeline already uses (bundled
 * Oswald-Bold.ttf, no system-font dependency), rather than sharp's own SVG
 * text rendering, which depends on fonts being installed on whatever
 * machine this runs on. That's already bitten this project once for an
 * unrelated reason -- ffmpeg-static's Linux binary missing the drawtext
 * filter outright, see the FFMPEG_PATH comment at the top of
 * lib/video-assemble.js -- so this avoids introducing a second, similarly
 * environment-dependent text-rendering path.
 */

const sharp = require("sharp");

const CARD_WIDTH = 1920;
const CARD_HEIGHT = 1080;

async function buildOutroBackground(lastPhotoBuffer) {
  return sharp(lastPhotoBuffer)
    .rotate()
    .resize({ width: CARD_WIDTH, height: CARD_HEIGHT, fit: "cover" })
    .modulate({ brightness: 0.45 })
    .blur(28)
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = { buildOutroBackground };
