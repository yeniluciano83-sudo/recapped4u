import { describe, it, expect } from "vitest";
import { getUploadLimit } from "./uploadLimits";

describe("getUploadLimit", () => {
  it("caps Highlight at 500", () => {
    expect(getUploadLimit("standard")).toBe(500);
  });

  it("caps Spotlight and Luxe at 2000 (advertised as unlimited)", () => {
    expect(getUploadLimit("premium")).toBe(2000);
    expect(getUploadLimit("keepsake")).toBe(2000);
  });

  it("falls back to the 500-photo default for Free and any unknown tier", () => {
    expect(getUploadLimit("free")).toBe(500);
    expect(getUploadLimit("something-new")).toBe(500);
    expect(getUploadLimit(undefined)).toBe(500);
  });
});
