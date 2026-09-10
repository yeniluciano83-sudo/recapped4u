import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { applyPolaroidFrame } from "./photo-frame";

// Real sharp end to end, no mocks -- this is genuine image compositing
// (server-side, feeding straight into a download), so what actually matters
// is verified against the real library, not a stand-in for it. Synthetic
// solid-color source images (not a fixture file) keep this fast and
// self-contained while still exercising the real pipeline.
async function solidColorJpeg(width, height, rgb) {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).jpeg().toBuffer();
}

describe("applyPolaroidFrame", () => {
  it("uses a chunky classic-instant-film border -- 5.5% of the width on the sides, 30% of the height on the bottom", async () => {
    const source = await solidColorJpeg(400, 300, { r: 30, g: 120, b: 200 });
    const framed = await applyPolaroidFrame(source);
    const meta = await sharp(framed).metadata();

    // Deliberately thicker than the recap video's thin 2.3% border: a
    // standalone downloaded JPG has no backdrop for a thin border to read
    // against, so it needs a beefier frame to look like a polaroid on its
    // own. See the comment in photo-frame.js.
    const expectedSideBorder = Math.max(4, Math.round(400 * 0.055));
    const expectedBottomBorder = Math.max(expectedSideBorder, Math.round(300 * 0.3));

    expect(meta.width).toBe(400 + expectedSideBorder * 2);
    expect(meta.height).toBe(300 + expectedSideBorder + expectedBottomBorder);
    expect(meta.format).toBe("jpeg");
    // The bottom strip is clearly the deepest edge.
    expect(expectedBottomBorder).toBeGreaterThan(expectedSideBorder * 2);
  });

  it("keeps the framed photo straight -- no rotation applied", async () => {
    // A tall, narrow source makes an accidental 90-degree rotation obvious:
    // the output would come back wider than it is tall if this ever
    // rotated instead of just bordering.
    const source = await solidColorJpeg(100, 500, { r: 200, g: 50, b: 50 });
    const framed = await applyPolaroidFrame(source);
    const meta = await sharp(framed).metadata();

    expect(meta.height).toBeGreaterThan(meta.width);
  });

  it("scales the border to the photo's own resolution, not a fixed pixel count", async () => {
    const small = await applyPolaroidFrame(await solidColorJpeg(200, 150, { r: 0, g: 0, b: 0 }));
    const large = await applyPolaroidFrame(await solidColorJpeg(2000, 1500, { r: 0, g: 0, b: 0 }));
    const smallMeta = await sharp(small).metadata();
    const largeMeta = await sharp(large).metadata();

    const smallBorderTotal = smallMeta.width - 200;
    const largeBorderTotal = largeMeta.width - 2000;
    // 10x the source width should mean roughly 10x the total border width,
    // not the same fixed number of pixels added either time.
    expect(largeBorderTotal).toBeGreaterThan(smallBorderTotal * 8);
  });
});
