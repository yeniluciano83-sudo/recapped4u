import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeGalleryExpiry } from "./galleryExpiry";

const NOW = new Date("2026-01-15T00:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeGalleryExpiry", () => {
  it("gives Free 7 days", () => {
    expect(computeGalleryExpiry("free")).toEqual(new Date("2026-01-22T00:00:00"));
  });

  it("gives Highlight 2 months", () => {
    expect(computeGalleryExpiry("standard")).toEqual(new Date("2026-03-15T00:00:00"));
  });

  it("gives Spotlight 4 months", () => {
    expect(computeGalleryExpiry("premium")).toEqual(new Date("2026-05-15T00:00:00"));
  });

  it("gives Luxe 6 months", () => {
    expect(computeGalleryExpiry("keepsake")).toEqual(new Date("2026-07-15T00:00:00"));
  });

  it("falls back to 90 days for an unknown tier", () => {
    expect(computeGalleryExpiry("something-new")).toEqual(new Date("2026-04-15T00:00:00"));
  });
});
