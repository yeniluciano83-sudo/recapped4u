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
  it("matches the recap video's polaroid proportions -- 2.333% side border, ~7.4x that on the bottom", async () => {
    const source = await solidColorJpeg(400, 300, { r: 30, g: 120, b: 200 });
    const framed = await applyPolaroidFrame(source);
    const meta = await sharp(framed).metadata();

    // Same ratios as lib/video-assemble.js's polaroid mode: polaroidBorder
    // is 0.014 of the frame width against a photo filling 0.6 of it (=>
    // 2.333% of the photo's width, on top + both sides), polaroidBorderBottom
    // is (0.185/0.014)*(9/16) times that on the bottom.
    const expectedSideBorder = Math.max(4, Math.round(400 * (0.014 / 0.6)));
    const expectedBottomBorder = Math.max(expectedSideBorder, Math.round(expectedSideBorder * (0.185 / 0.014) * (9 / 16)));

    expect(meta.width).toBe(400 + expectedSideBorder * 2);
    expect(meta.height).toBe(300 + expectedSideBorder + expectedBottomBorder);
    expect(meta.format).toBe("jpeg");
    // Sanity: the bottom strip should be several times the side border.
    expect(expectedBottomBorder).toBeGreaterThan(expectedSideBorder * 5);
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
