import sharp from "sharp";

// Multi-photo export for the Grid/Masonry gallery templates -- Polaroid
// (lib/photo-frame.js) frames one photo at a time because that's a
// per-photo style; Grid and Masonry aren't photo styles at all, they're
// page LAYOUTS (how several photos sit together), so there's nothing to
// bake into a single downloaded photo for them. What they actually export
// as is a contact-sheet-style collage: several photos composited onto one
// image, the way the layout arranges them on screen.
//
// A gallery can run into the thousands of photos (Spotlight/Luxe), so both
// builders take one SHEET's worth of already-fetched buffers at a time --
// app/api/gallery/[bookingId]/download-all/route.js chunks the full photo
// list into sheets of GRID_PHOTOS_PER_SHEET / MASONRY_PHOTOS_PER_SHEET and
// zips one image per sheet, the same shape "polaroid" already uses (one
// photo composited, one at a time, bounded memory regardless of gallery
// size).
export const GRID_PHOTOS_PER_SHEET = 12; // 3 columns x 4 rows
export const MASONRY_PHOTOS_PER_SHEET = 15;

const BG = "#FAF7F2"; // site's own page background (see components/ui.jsx's tone.cream)
const GAP = 16;
const MARGIN = 16;

const GRID_COLUMNS = 3;
const GRID_ROWS = 4;
const GRID_CELL_SIZE = 640;

const MASONRY_COLUMNS = 3;
const MASONRY_COLUMN_WIDTH = 640;

// Every photo lands fully visible, never cropped -- the same "nothing from
// the original is ever cut off" rule the video pipeline holds itself to
// (see lib/video-assemble.js's photoBackground comment). fit: "contain"
// does the CSS object-fit: contain equivalent AND pads to the exact cell
// size in one step, centering a photo that doesn't match the square cell's
// aspect ratio rather than stretching or cropping it -- matches
// GridLayout's own on-screen objectFit: "contain".
async function fitToSquareCell(buffer, size) {
  return sharp(buffer).rotate().resize(size, size, { fit: "contain", background: BG }).jpeg().toBuffer();
}

export async function buildGridSheet(buffers) {
  const cols = GRID_COLUMNS;
  const cellSize = GRID_CELL_SIZE;
  // Capped at one sheet's worth, but sized to however many of those this
  // call actually got -- the last (or only) sheet for a gallery whose count
  // isn't a clean multiple of GRID_PHOTOS_PER_SHEET must not reserve full
  // rows of empty canvas for photos that were never passed in.
  const cells = buffers.slice(0, cols * GRID_ROWS);
  const rows = Math.ceil(cells.length / cols);
  const sheetWidth = MARGIN * 2 + cellSize * cols + GAP * (cols - 1);
  const sheetHeight = MARGIN * 2 + cellSize * rows + GAP * (rows - 1);

  const fitted = await Promise.all(cells.map((buf) => fitToSquareCell(buf, cellSize)));
  const composites = fitted.map((input, i) => ({
    input,
    left: MARGIN + (i % cols) * (cellSize + GAP),
    top: MARGIN + Math.floor(i / cols) * (cellSize + GAP),
  }));

  return sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: BG } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function buildMasonrySheet(buffers) {
  const cols = MASONRY_COLUMNS;
  const colWidth = MASONRY_COLUMN_WIDTH;
  const columnHeights = new Array(cols).fill(MARGIN);
  const placements = [];

  // Sequential, not Promise.all -- each placement depends on the running
  // column heights from the ones before it, same real masonry packing
  // MasonryLayout's CSS column-count achieves in the browser for free (a
  // greedy shortest-column-next placement here, since we're the one doing
  // the layout math ourselves this time).
  for (const buf of buffers.slice(0, MASONRY_PHOTOS_PER_SHEET)) {
    // No fit: "contain"/background here, unlike the grid cell -- masonry's
    // whole point is that each photo keeps its own natural height at a
    // fixed width, not padded into a uniform box.
    const resized = await sharp(buf).rotate().resize(colWidth, null, { fit: "inside" }).jpeg().toBuffer();
    const { height } = await sharp(resized).metadata();
    const col = columnHeights.indexOf(Math.min(...columnHeights));
    placements.push({ input: resized, left: MARGIN + col * (colWidth + GAP), top: Math.round(columnHeights[col]) });
    columnHeights[col] += height + GAP;
  }

  const sheetWidth = MARGIN * 2 + colWidth * cols + GAP * (cols - 1);
  const sheetHeight = Math.round(Math.max(...columnHeights) - GAP + MARGIN);

  return sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: BG } })
    .composite(placements)
    .jpeg({ quality: 90 })
    .toBuffer();
}
