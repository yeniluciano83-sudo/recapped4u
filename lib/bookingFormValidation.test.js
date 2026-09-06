import { describe, it, expect } from "vitest";
import { canProceedFromStyleStep } from "./bookingFormValidation";

describe("canProceedFromStyleStep", () => {
  describe("tiers below Spotlight/Luxe -- no delivery format, always a full video", () => {
    const base = { isSocialCutEligible: false, isSocialCutsFormat: false, deliveryFormat: "" };

    it("blocks with no style picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "", socialStyle: "" })).toBe(false);
    });

    it("allows once a style is picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "cinematic", socialStyle: "" })).toBe(true);
    });
  });

  describe("Spotlight/Luxe -- delivery format required before anything else", () => {
    it("blocks with no delivery format chosen yet, even if a style is already picked", () => {
      expect(canProceedFromStyleStep({
        isSocialCutEligible: true, isSocialCutsFormat: false, deliveryFormat: "",
        style: "cinematic", socialStyle: "",
      })).toBe(false);
    });
  });

  describe('Spotlight/Luxe -- "recap" (full video + social cuts)', () => {
    const base = { isSocialCutEligible: true, isSocialCutsFormat: false, deliveryFormat: "recap" };

    it("blocks with no main-video style picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "", socialStyle: "" })).toBe(false);
    });

    it("allows once the main-video style is picked, even with no separate social style", () => {
      // socialStyle unset is a real, deliberate choice here -- it falls
      // back to the main style (see app/booking/page.jsx), not a missing
      // requirement.
      expect(canProceedFromStyleStep({ ...base, style: "upbeat", socialStyle: "" })).toBe(true);
    });
  });

  describe('Spotlight/Luxe -- "video_only" (full video, no social cuts)', () => {
    const base = { isSocialCutEligible: true, isSocialCutsFormat: false, deliveryFormat: "video_only" };

    it("blocks with no style picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "", socialStyle: "" })).toBe(false);
    });

    it("allows once a style is picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "documentary", socialStyle: "" })).toBe(true);
    });
  });

  describe('Spotlight/Luxe -- "social_cuts" (social cuts only, no full video)', () => {
    const base = { isSocialCutEligible: true, isSocialCutsFormat: true, deliveryFormat: "social_cuts" };

    it("blocks with no social style picked -- style (the main-video field) being set doesn't count", () => {
      expect(canProceedFromStyleStep({ ...base, style: "cinematic", socialStyle: "" })).toBe(false);
    });

    it("allows once a social style is picked", () => {
      expect(canProceedFromStyleStep({ ...base, style: "", socialStyle: "retro" })).toBe(true);
    });

    it('allows the explicit "No theme" choice -- that is a real answer, not an unanswered field', () => {
      expect(canProceedFromStyleStep({ ...base, style: "", socialStyle: "none" })).toBe(true);
    });
  });
});
