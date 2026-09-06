import { describe, it, expect } from "vitest";
import { canProceedFromStyleStep, hasMadeRequiredRoastChoice } from "./bookingFormValidation";

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

describe("hasMadeRequiredRoastChoice", () => {
  // Deliberately separate from canProceedFromStyleStep -- that function is
  // shared with app/api/bookings/route.js as the server-side source of
  // truth, and roastChoiceMade is a client-only UX flag with nothing for
  // the server to check (roastEnabled: false is already a perfectly valid
  // stored value on its own). This function is never called server-side.

  it("is not required on any format other than social-cuts-only", () => {
    expect(hasMadeRequiredRoastChoice({ isSocialCutsFormat: false, roastChoiceMade: false })).toBe(true);
    expect(hasMadeRequiredRoastChoice({ isSocialCutsFormat: false, roastChoiceMade: undefined })).toBe(true);
  });

  it("blocks social-cuts-only until the roast toggle has actually been touched", () => {
    expect(hasMadeRequiredRoastChoice({ isSocialCutsFormat: true, roastChoiceMade: false })).toBe(false);
    expect(hasMadeRequiredRoastChoice({ isSocialCutsFormat: true, roastChoiceMade: undefined })).toBe(false);
  });

  it("allows social-cuts-only once touched, regardless of which way it was decided", () => {
    // roastChoiceMade tracks that a choice was made, not what it was -- an
    // explicit "no roast" (roastEnabled stays false) satisfies this exactly
    // like an explicit "yes" does.
    expect(hasMadeRequiredRoastChoice({ isSocialCutsFormat: true, roastChoiceMade: true })).toBe(true);
  });
});
