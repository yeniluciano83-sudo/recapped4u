import sharp from "sharp";

// Only ever applied on request (?style=polaroid) -- see
// app/api/gallery/[bookingId]/download-all/route.js and .../photo/[index]
// /route.js, the two download paths this backs. Downloads default to the
// plain photo untouched: PolaroidLayout's on-screen frame is a browsing
// choice, and plenty of hosts download photos to print or reuse elsewhere,
// where a baked-in border isn't necessarily wanted.
//
// Proportions match the render pipeline's own polaroid video mode exactly
// (lib/video-assemble.js's photoBackground === "polaroid" branch), so a
// downloaded photo, the on-screen tile, and the recap video all show the
// same card:
//   - cream card colour #F7F3E9 (0xF7F3E9 in the ffmpeg chain)
//   - an even border on top + both sides at 2.333% of the photo's width
//     (the video's polaroidBorder is 1.4% of the frame width, against a
//     photo filling 60% of it: 0.014 / 0.6)
//   - a caption strip along the bottom ~7.4x thicker (the video's
//     polaroidBorder vs polaroidBorderBottom is 0.014*W vs 0.185*H on a
//     16:9 frame, i.e. (0.185 / 0.014) * (9 / 16) times the side border)
//   - the photo's own aspect ratio kept, never cropped
//
// Straight, not tilted -- the video tilts each card over a backdrop, but a
// standalone JPG has no backdrop, so a rotation would just leave odd
// cream-filled angled corners in a file meant for printing.
const SIDE_RATIO = 0.014 / 0.6;
const BOTTOM_TO_SIDE = (0.185 / 0.014) * (9 / 16); // ~7.43
const CARD_COLOR = "#F7F3E9";

export async function applyPolaroidFrame(buffer) {
  // .rotate() with no args auto-orients from EXIF -- resolving to a buffer
  // first (rather than chaining .extend() straight off the pipeline) means
  // `info.width` below is the real, already-corrected width, not the
  // pre-rotation value metadata() alone would report for a sideways photo.
  const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const border = Math.max(4, Math.round(info.width * SIDE_RATIO));
  const bottomBorder = Math.max(border, Math.round(border * BOTTOM_TO_SIDE));

  return sharp(data)
    .extend({ top: border, bottom: bottomBorder, left: border, right: border, background: CARD_COLOR })
    .jpeg({ quality: 92 })
    .toBuffer();
}
