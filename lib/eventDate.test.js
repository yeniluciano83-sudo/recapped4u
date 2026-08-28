import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hoursUntilEventDate, isAtLeast24HoursOut } from "./eventDate";

// Fixed "now" so the 24-hour boundary can be tested exactly, instead of
// depending on when the suite happens to run.
const NOW = new Date("2026-06-15T00:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hoursUntilEventDate", () => {
  it("measures from midnight on the event date, not the current time of day", () => {
    expect(hoursUntilEventDate("2026-06-16")).toBe(24);
  });

  it("is negative for a date in the past", () => {
    expect(hoursUntilEventDate("2026-06-14")).toBe(-24);
  });

  it("is zero for today", () => {
    expect(hoursUntilEventDate("2026-06-15")).toBe(0);
  });
});

describe("isAtLeast24HoursOut", () => {
  it("is eligible at exactly 24 hours out", () => {
    expect(isAtLeast24HoursOut("2026-06-16")).toBe(true);
  });

  it("is eligible further than 24 hours out", () => {
    expect(isAtLeast24HoursOut("2026-06-20")).toBe(true);
  });

  it("is not eligible inside 24 hours", () => {
    vi.setSystemTime(new Date("2026-06-15T01:00:00"));
    expect(isAtLeast24HoursOut("2026-06-16")).toBe(false);
  });

  it("is not eligible for a same-day or past event", () => {
    expect(isAtLeast24HoursOut("2026-06-15")).toBe(false);
    expect(isAtLeast24HoursOut("2026-06-10")).toBe(false);
  });
});
