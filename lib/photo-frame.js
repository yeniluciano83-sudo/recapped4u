import sharp from "sharp";

// Only ever applied on request (?style=polaroid) -- see
// app/api/gallery/[bookingId]/download-all/route.js and .../photo/[index]
// /route.js, the two download paths this backs. Downloads default to the
// plain photo untouched, same as before this existed: PolaroidLayout's
// on-screen frame is a browsing choice (CSS around an <img>, no pixels
// touched), and plenty of hosts download photos to print or reuse elsewhere,
// where a baked-in border isn't necessarily wanted. This is the opt-in for
// the host who wants their download to actually look like what they were
// browsing.
//
// Straight, not tilted -- PolaroidLayout's on-screen tilt is a browsing
// flourish for a scattered pile of cards; a single saved file sits straight.
// Border proportions match that same on-screen card (10px sides / 14px
// bottom on a ~220px-wide tile), scaled up to the photo's own resolution
// since a downloaded/printed file needs a border sized to its actual
// pixels, not the browser's CSS px. Same card colour as the video
// pipeline's own polaroid mode (lib/video-assemble.js) for consistency.
const BORDER_RATIO = 10 / 220;
const BOTTOM_RATIO = 14 / 220;
const CARD_COLOR = "#F7F3E9";

export async function applyPolaroidFrame(buffer) {
  // .rotate() with no args auto-orients from EXIF -- resolving to a buffer
  // first (rather than chaining .extend() straight off the pipeline) means
  // `info.width` below is the real, already-corrected width, not the
  // pre-rotation value metadata() alone would report for a sideways photo.
  const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const border = Math.max(4, Math.round(info.width * BORDER_RATIO));
  const bottomBorder = Math.max(border, Math.round(info.width * BOTTOM_RATIO));

  return sharp(data)
    .extend({ top: border, bottom: bottomBorder, left: border, right: border, background: CARD_COLOR })
    .jpeg({ quality: 92 })
    .toBuffer();
}
