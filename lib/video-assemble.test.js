import { describe, it, expect } from "vitest";
import { planChunks, MAX_SLOTS_PER_CHUNK } from "./video-assemble.js";

// planChunks is the load-bearing bit of resumable rendering: chunk indices
// have to be stable across separate scheduled runs (a run persists "chunk 7
// done" and a later run must render exactly the same slot range for chunk 7),
// so its arithmetic is pinned here.
describe("planChunks", () => {
  it("uses MAX_SLOTS_PER_CHUNK (5) per chunk with a short final chunk", () => {
    const plan = planChunks(12, 0);
    expect(plan.map((c) => [c.start, c.end])).toEqual([
      [0, 5],
      [5, 10],
      [10, 12],
    ]);
  });

  it("covers every slot exactly once, in order, with no gaps", () => {
    for (const n of [1, 5, 6, 7, 40, 82, 301]) {
      const plan = planChunks(n, 0);
      expect(plan[0].start).toBe(0);
      expect(plan[plan.length - 1].end).toBe(n);
      for (let i = 1; i < plan.length; i++) expect(plan[i].start).toBe(plan[i - 1].end);
      expect(plan.length).toBe(Math.ceil(n / MAX_SLOTS_PER_CHUNK));
      for (const c of plan) expect(c.end - c.start).toBeLessThanOrEqual(MAX_SLOTS_PER_CHUNK);
    }
  });

  it("splits the image/clip boundary correctly within a chunk", () => {
    // 3 images + 4 clips = 7 slots -> chunk 0 = [0,5) spans 3 images + 2 clips,
    // chunk 1 = [5,7) is 2 clips, no images.
    const plan = planChunks(3, 4);
    expect(plan).toEqual([
      { start: 0, end: 5, imageStart: 0, imageEnd: 3, clipStart: 0, clipEnd: 2 },
      { start: 5, end: 7, imageStart: 3, imageEnd: 3, clipStart: 2, clipEnd: 4 },
    ]);
  });

  it("is a single chunk at or under the limit, and empty for zero slots", () => {
    expect(planChunks(0, 0)).toEqual([]);
    expect(planChunks(5, 0)).toHaveLength(1);
    expect(planChunks(1, 0)[0]).toMatchObject({ start: 0, end: 1, imageStart: 0, imageEnd: 1 });
  });
});
