import { describe, it, expect } from "vitest";
import { resolveMusicSelection, STYLE_TRACK_COUNTS } from "./musicTrack";

describe("resolveMusicSelection", () => {
  it("keeps a valid track number for a known style", () => {
    expect(resolveMusicSelection("cinematic", 3)).toEqual({ style: "cinematic", track: 3 });
  });

  it("clamps back to track 1 when the number is out of range", () => {
    expect(resolveMusicSelection("highlight", STYLE_TRACK_COUNTS.highlight + 1)).toEqual({ style: "highlight", track: 1 });
    expect(resolveMusicSelection("retro", STYLE_TRACK_COUNTS.retro + 1)).toEqual({ style: "retro", track: 1 });
  });

  it("clamps back to track 1 for zero, negative, non-integer, or unset track numbers", () => {
    expect(resolveMusicSelection("upbeat", 0)).toEqual({ style: "upbeat", track: 1 });
    expect(resolveMusicSelection("upbeat", -2)).toEqual({ style: "upbeat", track: 1 });
    expect(resolveMusicSelection("upbeat", 2.5)).toEqual({ style: "upbeat", track: 1 });
    expect(resolveMusicSelection("upbeat", null)).toEqual({ style: "upbeat", track: 1 });
    expect(resolveMusicSelection("upbeat", undefined)).toEqual({ style: "upbeat", track: 1 });
  });

  it("falls back to cinematic for an unrecognized style", () => {
    expect(resolveMusicSelection("nonexistent", 2)).toEqual({ style: "cinematic", track: 2 });
  });

  it("accepts the highest valid track number for each style", () => {
    for (const [style, count] of Object.entries(STYLE_TRACK_COUNTS)) {
      expect(resolveMusicSelection(style, count)).toEqual({ style, track: count });
    }
  });
});
