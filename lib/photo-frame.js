import sharp from "sharp";

// Only ever applied on request (?style=polaroid) -- see
// app/api/gallery/[bookingId]/download-all/route.js and .../photo/[index]
// /route.js, the two download paths this backs. Downloads default to the
// plain photo untouched.
//
// The on-screen tile and the recap video use the video pipeline's exact
// thin-bordered proportions (2.333% sides), which read as a polaroid there
// because the card floats on a backdrop. A standalone downloaded JPG has no
// backdrop, so those thin borders just look like a plain margin -- worst on
// wide photos. This deliberately uses a chunkier, classic-instant-film
// border instead so a saved file unmistakably reads as a polaroid on its
// own: ~5.5% of the photo's width on top + both sides, ~30% of the photo's
// height on the bottom (a real SX-70 is roughly 5.7% / 29.7% of its square
// image), never smaller than the side border for an unusually wide photo.
// Cream card colour #F7F3E9 (matches the video pipeline and the on-screen
// tile). Straight, not tilted -- a standalone JPG has no backdrop to fill
// tilted corners against.
const SIDE_RATIO = 0.055; // of the photo's width -- left, right, top
const BOTTOM_RATIO = 0.30; // of the photo's height -- bottom caption strip
const CARD_COLOR = "#F7F3E9";

export async function applyPolaroidFrame(buffer) {
  // .rotate() with no args auto-orients from EXIF -- resolving to a buffer
  // first (rather than chaining .extend() straight off the pipeline) means
  // info.width/height below are the real, already-corrected dimensions, not
  // the pre-rotation values metadata() alone would report for a sideways
  // photo.
  const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const border = Math.max(4, Math.round(info.width * SIDE_RATIO));
  const bottomBorder = Math.max(border, Math.round(info.height * BOTTOM_RATIO));

  return sharp(data)
    .extend({ top: border, bottom: bottomBorder, left: border, right: border, background: CARD_COLOR })
    .jpeg({ quality: 92 })
    .toBuffer();
}
