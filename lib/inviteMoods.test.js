import { describe, it, expect } from "vitest";
import { getInviteMood } from "./inviteMoods";

describe("getInviteMood", () => {
  it("maps a wedding to the romantic mood", () => {
    expect(getInviteMood("Wedding").key).toBe("romantic");
  });

  it("maps a corporate event to the professional mood", () => {
    expect(getInviteMood("Corporate Event").key).toBe("professional");
  });

  it("falls back to generic for Party and Other", () => {
    expect(getInviteMood("Party").key).toBe("generic");
    expect(getInviteMood("Other").key).toBe("generic");
  });

  it("falls back to generic for unrecognized custom text (an 'Other' free-text answer)", () => {
    expect(getInviteMood("Milestone Cook-off").key).toBe("generic");
  });

  it("falls back to generic for an empty/missing event type", () => {
    expect(getInviteMood("").key).toBe("generic");
    expect(getInviteMood(undefined).key).toBe("generic");
  });

  it("returns a complete palette for every mood", () => {
    for (const eventType of ["Wedding", "Birthday", "Corporate Event", "Family Reunion", "Party"]) {
      const mood = getInviteMood(eventType);
      expect(mood.blobs).toHaveLength(2);
      expect(mood.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(mood.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(mood.card).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(mood.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
