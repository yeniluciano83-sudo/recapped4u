import { describe, it, expect } from "vitest";
import { buildSocialSelections, MAX_SOCIAL_PHOTOS } from "./socialSelections";

function makePhoto(id, score, mustInclude = false) {
  return { analysis: { emotional_strength: score, technical_quality: 0 }, upload: { id, must_include_social: mustInclude } };
}

describe("buildSocialSelections", () => {
  it("puts every photo in the single cut when there's fewer than the per-cut max", () => {
    const photos = [makePhoto("a", 90), makePhoto("b", 50), makePhoto("c", 70)];
    const result = buildSocialSelections(photos, 1);
    expect(result).toHaveLength(1);
    expect(result[0].map((p) => p.upload.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("guarantees a host-starred must-include photo lands in the first cut, even when it scores lowest", () => {
    const photos = [makePhoto("high1", 100), makePhoto("high2", 90), makePhoto("mustinclude", 1, true)];
    const result = buildSocialSelections(photos, 1);
    expect(result[0].map((p) => p.upload.id)).toContain("mustinclude");
  });

  it("splits a large photo pool into per-cut batches of the per-cut max, best-scored first", () => {
    const photos = Array.from({ length: 20 }, (_, i) => makePhoto(`p${i}`, 20 - i)); // p0 scores highest
    const result = buildSocialSelections(photos, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(MAX_SOCIAL_PHOTOS);
    expect(result[1]).toHaveLength(5);
    // Best-scored photos (p0..p14) fill the first cut; the rest spill to the second.
    expect(result[0].map((p) => p.upload.id)).toEqual(Array.from({ length: 15 }, (_, i) => `p${i}`));
    expect(result[1].map((p) => p.upload.id)).toEqual(["p15", "p16", "p17", "p18", "p19"]);
  });

  it("stops early when the photo pool runs out, even if more cuts were requested", () => {
    const photos = Array.from({ length: 20 }, (_, i) => makePhoto(`p${i}`, 20 - i));
    const result = buildSocialSelections(photos, 5); // only enough photos for 2 cuts
    expect(result).toHaveLength(2);
  });

  it("returns no cuts at all for an empty photo pool", () => {
    expect(buildSocialSelections([], 3)).toEqual([]);
  });

  it("caps must-include photos at the per-cut max, dropping the lowest-scored overflow", () => {
    const mustIncludes = Array.from({ length: 18 }, (_, i) => makePhoto(`m${i}`, 18 - i, true)); // m0 scores highest
    const result = buildSocialSelections(mustIncludes, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(MAX_SOCIAL_PHOTOS);
    // The 3 lowest-scored must-includes (m15, m16, m17) get dropped.
    expect(result[0].map((p) => p.upload.id)).not.toContain("m17");
    expect(result[0].map((p) => p.upload.id)).toContain("m0");
  });
});
