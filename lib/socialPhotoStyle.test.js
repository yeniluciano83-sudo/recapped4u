import { describe, it, expect } from "vitest";
import { resolveSocialPhotoStyle, socialPhotoNeedsSeparateGrade } from "./socialPhotoStyle";

describe("resolveSocialPhotoStyle", () => {
  it("prefers an explicit social style over the main style", () => {
    expect(resolveSocialPhotoStyle({ style: "cinematic", socialStyle: "retro" })).toBe("retro");
  });

  it("falls back to the main style when no social style is set", () => {
    expect(resolveSocialPhotoStyle({ style: "upbeat", socialStyle: null })).toBe("upbeat");
    expect(resolveSocialPhotoStyle({ style: "upbeat", socialStyle: undefined })).toBe("upbeat");
  });

  it("resolves to the social style alone on social-cuts-only, where the main style is null", () => {
    expect(resolveSocialPhotoStyle({ style: null, socialStyle: "highlight" })).toBe("highlight");
  });

  // "none" (the explicit "No theme (no music)" choice) is a real, deliberate
  // answer, distinct from "unset" -- it must not fall through to style the
  // way null/undefined does.
  it('treats "none" as a real choice, not an unset value', () => {
    expect(resolveSocialPhotoStyle({ style: "cinematic", socialStyle: "none" })).toBe("none");
  });
});

describe("socialPhotoNeedsSeparateGrade", () => {
  it("is false on social-cuts-only regardless of style values -- there is no separate main style to diverge from", () => {
    expect(socialPhotoNeedsSeparateGrade({ style: null, socialStyle: "retro", useAllPhotoSocialCuts: true })).toBe(false);
    expect(socialPhotoNeedsSeparateGrade({ style: null, socialStyle: null, useAllPhotoSocialCuts: true })).toBe(false);
  });

  it("is false when there's no social style set -- the shared buffer is already correct", () => {
    expect(socialPhotoNeedsSeparateGrade({ style: "cinematic", socialStyle: null, useAllPhotoSocialCuts: false })).toBe(false);
  });

  it("is false when the social style matches the main style -- nothing would actually change", () => {
    expect(socialPhotoNeedsSeparateGrade({ style: "cinematic", socialStyle: "cinematic", useAllPhotoSocialCuts: false })).toBe(false);
  });

  it("is true on a recap booking with a genuinely distinct social-cut theme -- this is the bug case", () => {
    expect(socialPhotoNeedsSeparateGrade({ style: "cinematic", socialStyle: "retro", useAllPhotoSocialCuts: false })).toBe(true);
  });

  it('is true when social style is the explicit "none" and differs from a set main style', () => {
    expect(socialPhotoNeedsSeparateGrade({ style: "cinematic", socialStyle: "none", useAllPhotoSocialCuts: false })).toBe(true);
  });
});
