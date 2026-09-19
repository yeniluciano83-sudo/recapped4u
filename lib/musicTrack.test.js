import { describe, it, expect } from "vitest";
import { resolveMusicSelection, buildMusicPlaylist, STYLE_TRACK_COUNTS } from "./musicTrack";

// Every track is a flat 200 seconds -- keeps the "how many tracks does it
// take to cover N seconds" arithmetic in each test obvious, since the point
// here is the sequencing/repeat logic, not real track lengths.
const FLAT_200S = async () => 200;

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

describe("buildMusicPlaylist", () => {
  it("returns just the single selected track for a non-finite, missing, or non-positive target duration", async () => {
    expect(await buildMusicPlaylist("cinematic", 3, undefined, FLAT_200S)).toEqual({ style: "cinematic", tracks: [3] });
    expect(await buildMusicPlaylist("cinematic", 3, NaN, FLAT_200S)).toEqual({ style: "cinematic", tracks: [3] });
    expect(await buildMusicPlaylist("cinematic", 3, Infinity, FLAT_200S)).toEqual({ style: "cinematic", tracks: [3] });
    expect(await buildMusicPlaylist("cinematic", 3, 0, FLAT_200S)).toEqual({ style: "cinematic", tracks: [3] });
    expect(await buildMusicPlaylist("cinematic", 3, -5, FLAT_200S)).toEqual({ style: "cinematic", tracks: [3] });
  });

  it("returns just the single track when it alone already covers the target", async () => {
    const { style, tracks } = await buildMusicPlaylist("cinematic", 3, 150, FLAT_200S); // one 200s track already covers 150s
    expect(style).toBe("cinematic");
    expect(tracks).toEqual([3]);
  });

  it("adds tracks in ascending order after the host's own pick until the target is covered", async () => {
    // 3 tracks * 200s = 600s covers a 550s target; a 4th isn't needed.
    const { tracks } = await buildMusicPlaylist("upbeat", 5, 550, FLAT_200S);
    expect(tracks).toEqual([5, 1, 2]);
  });

  it("cycles back through the whole pool (host's pick included) again once one full pass isn't enough", async () => {
    // cinematic has 9 tracks * 200s = 1800s per pass; asking for 2000s needs
    // a 10th play, which wraps back around to the host's own pick (3).
    const { tracks } = await buildMusicPlaylist("cinematic", 3, 2000, FLAT_200S);
    expect(tracks).toHaveLength(10);
    expect(tracks[9]).toBe(3);
    expect(tracks.slice(0, 9).sort((a, b) => a - b)).toEqual(Array.from({ length: 9 }, (_, i) => i + 1));
  });

  it("still clamps/falls back the same way resolveMusicSelection does before building the playlist", async () => {
    expect((await buildMusicPlaylist("nonexistent", 2, 1000, FLAT_200S)).style).toBe("cinematic");
    const { tracks } = await buildMusicPlaylist("upbeat", 999, 1000, FLAT_200S); // out of range -> clamps to track 1
    expect(tracks[0]).toBe(1);
  });

  it("calls the injected duration lookup with the resolved style and each track it adds, never more than needed", async () => {
    const calls = [];
    const spy = async (style, track) => { calls.push([style, track]); return 100; };
    await buildMusicPlaylist("documentary", 2, 250, spy); // 100s * 3 = 300s, covers 250s -> exactly 3 calls
    expect(calls).toEqual([["documentary", 2], ["documentary", 1], ["documentary", 3]]);
  });
});
