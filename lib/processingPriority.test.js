import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hoursSinceEvent, sortByProcessingPriority } from "./processingPriority";

describe("hoursSinceEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is positive for an event that already happened", () => {
    expect(hoursSinceEvent("2026-06-14T12:00:00")).toBe(24);
  });

  it("is negative for an event that hasn't happened yet", () => {
    expect(hoursSinceEvent("2026-06-16T12:00:00")).toBe(-24);
  });
});

describe("sortByProcessingPriority", () => {
  it("orders Luxe, then Spotlight, then Highlight, then Free -- regardless of input order", () => {
    const bookings = [
      { id: "a", tier: "free", event_date: "2026-06-01" },
      { id: "b", tier: "keepsake", event_date: "2026-06-01" },
      { id: "c", tier: "standard", event_date: "2026-06-01" },
      { id: "d", tier: "premium", event_date: "2026-06-01" },
    ];
    expect(sortByProcessingPriority(bookings).map((b) => b.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("breaks ties within the same tier by earliest event_date first", () => {
    const bookings = [
      { id: "later", tier: "keepsake", event_date: "2026-06-10" },
      { id: "earlier", tier: "keepsake", event_date: "2026-06-01" },
    ];
    expect(sortByProcessingPriority(bookings).map((b) => b.id)).toEqual(["earlier", "later"]);
  });

  it("never lets a lower tier jump ahead of Luxe even when Luxe's event is later", () => {
    const bookings = [
      { id: "free-urgent", tier: "free", event_date: "2026-06-01" },
      { id: "luxe-later", tier: "keepsake", event_date: "2026-06-20" },
    ];
    expect(sortByProcessingPriority(bookings).map((b) => b.id)).toEqual(["luxe-later", "free-urgent"]);
  });

  it("sorts an unrecognized tier last, after Free", () => {
    const bookings = [
      { id: "unknown", tier: "something-new", event_date: "2026-06-01" },
      { id: "free", tier: "free", event_date: "2026-06-01" },
    ];
    expect(sortByProcessingPriority(bookings).map((b) => b.id)).toEqual(["free", "unknown"]);
  });

  it("does not mutate the input array", () => {
    const bookings = [
      { id: "a", tier: "free", event_date: "2026-06-01" },
      { id: "b", tier: "keepsake", event_date: "2026-06-01" },
    ];
    const copy = [...bookings];
    sortByProcessingPriority(bookings);
    expect(bookings).toEqual(copy);
  });
});
