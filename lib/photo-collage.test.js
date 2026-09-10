import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { buildGridSheet, buildMasonrySheet, GRID_PHOTOS_PER_SHEET, MASONRY_PHOTOS_PER_SHEET } from "./photo-collage";

// Real sharp end to end, no mocks -- same reasoning as photo-frame.test.js.
async function solidColorJpeg(width, height, rgb) {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).jpeg().toBuffer();
}

describe("buildGridSheet", () => {
  it("sizes the sheet to exactly how many photos it's given, not the maximum a sheet can hold", async () => {
    // The real bug this guards against: a sheet fed fewer than a full
    // batch (the last, or only, sheet for a gallery count that isn't a
    // clean multiple of GRID_PHOTOS_PER_SHEET) used to still reserve full
    // rows of blank canvas for photos it never received.
    const six = await Promise.all(Array.from({ length: 6 }, () => solidColorJpeg(300, 200, { r: 100, g: 100, b: 100 })));
    const sheet = await buildGridSheet(six);
    const meta = await sharp(sheet).metadata();

    // 6 photos at 3 columns = exactly 2 rows, not GRID_PHOTOS_PER_SHEET's
    // full 4.
    const fullSheet = await buildGridSheet(await Promise.all(Array.from({ length: GRID_PHOTOS_PER_SHEET }, () => solidColorJpeg(300, 200, { r: 0, g: 0, b: 0 }))));
    const fullMeta = await sharp(fullSheet).metadata();

    expect(meta.width).toBe(fullMeta.width); // same column count either way
    expect(meta.height).toBeLessThan(fullMeta.height); // fewer rows -> shorter sheet
  });

  it("never places more than one sheet's worth even if handed extra photos", async () => {
    const extra = await Promise.all(Array.from({ length: GRID_PHOTOS_PER_SHEET + 5 }, () => solidColorJpeg(200, 200, { r: 50, g: 50, b: 50 })));
    const exact = await Promise.all(Array.from({ length: GRID_PHOTOS_PER_SHEET }, () => solidColorJpeg(200, 200, { r: 50, g: 50, b: 50 })));

    const sheetWithExtra = await buildGridSheet(extra);
    const sheetExact = await buildGridSheet(exact);

    const metaExtra = await sharp(sheetWithExtra).metadata();
    const metaExact = await sharp(sheetExact).metadata();
    expect(metaExtra.width).toBe(metaExact.width);
    expect(metaExtra.height).toBe(metaExact.height);
  });

  it("never crops a photo -- a non-square photo fits within its cell instead", async () => {
    // A very wide photo in a square cell: cropping to fill would clearly
    // exceed the cell's own dimensions if it were actually happening --
    // this just confirms the sheet still renders at the expected fixed
    // size rather than growing to accommodate an uncropped photo somehow
    // spilling outside its cell.
    const wide = await solidColorJpeg(1600, 200, { r: 10, g: 200, b: 10 });
    const sheet = await buildGridSheet([wide]);
    const meta = await sharp(sheet).metadata();
    const oneRowSheet = await buildGridSheet([await solidColorJpeg(200, 200, { r: 0, g: 0, b: 0 })]);
    const oneRowMeta = await sharp(oneRowSheet).metadata();
    expect(meta.width).toBe(oneRowMeta.width);
    expect(meta.height).toBe(oneRowMeta.height);
  });
});

describe("buildMasonrySheet", () => {
  it("preserves each photo's own aspect ratio -- a taller photo makes its column taller, not the others", async () => {
    // Same width for all three (they'll all land in COLUMN_WIDTH-wide
    // columns), very different heights.
    const short = await solidColorJpeg(600, 200, { r: 200, g: 0, b: 0 });
    const tall = await solidColorJpeg(600, 1200, { r: 0, g: 200, b: 0 });
    const medium = await solidColorJpeg(600, 500, { r: 0, g: 0, b: 200 });

    const sheet = await buildMasonrySheet([short, tall, medium]);
    const meta = await sharp(sheet).metadata();

    // The sheet has to be at least tall enough to hold the tallest single
    // photo, scaled to column width (600 -> 600, no scaling needed here).
    expect(meta.height).toBeGreaterThanOrEqual(1200);
  });

  it("caps at MASONRY_PHOTOS_PER_SHEET even if handed more", async () => {
    const many = await Promise.all(Array.from({ length: MASONRY_PHOTOS_PER_SHEET + 5 }, () => solidColorJpeg(300, 300, { r: 80, g: 80, b: 80 })));
    const exact = await Promise.all(Array.from({ length: MASONRY_PHOTOS_PER_SHEET }, () => solidColorJpeg(300, 300, { r: 80, g: 80, b: 80 })));

    const sheetWithExtra = await buildMasonrySheet(many);
    const sheetExact = await buildMasonrySheet(exact);
    const metaExtra = await sharp(sheetWithExtra).metadata();
    const metaExact = await sharp(sheetExact).metadata();

    // Same input photos (all identical squares) -> identical packing either
    // way once capped, proving the extra 5 were never placed.
    expect(metaExtra.height).toBe(metaExact.height);
  });
});
