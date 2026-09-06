import { describe, it, expect, beforeEach } from "vitest";
import { generateHostToken, isValidHostToken, hostTokenFromRequest } from "./hostToken";
import { generateConfirmToken } from "./confirmToken";

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-signing-secret";
});

describe("generateHostToken", () => {
  it("is deterministic for the same booking id", () => {
    expect(generateHostToken("booking-1")).toBe(generateHostToken("booking-1"));
  });

  it("differs between booking ids", () => {
    expect(generateHostToken("booking-1")).not.toBe(generateHostToken("booking-2"));
  });

  it("differs when the signing secret differs", () => {
    const tokenA = generateHostToken("booking-1");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-secret";
    expect(generateHostToken("booking-1")).not.toBe(tokenA);
  });

  // The whole point of the "host-action:" prefix. A booking-confirmation link
  // is emailed before the event and is a weaker credential; it must not double
  // as authorization to cancel that booking.
  it("is not interchangeable with a confirm token for the same booking", () => {
    expect(generateHostToken("booking-1")).not.toBe(generateConfirmToken("booking-1"));
    expect(isValidHostToken("booking-1", generateConfirmToken("booking-1"))).toBe(false);
  });
});

describe("isValidHostToken", () => {
  it("accepts the token generated for that exact booking id", () => {
    expect(isValidHostToken("booking-1", generateHostToken("booking-1"))).toBe(true);
  });

  it("rejects another booking's token", () => {
    expect(isValidHostToken("booking-1", generateHostToken("booking-2"))).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(isValidHostToken("booking-1", null)).toBe(false);
    expect(isValidHostToken("booking-1", undefined)).toBe(false);
    expect(isValidHostToken("booking-1", "")).toBe(false);
  });

  // A guest holds the upload_slug, so the obvious forgery is to pass that
  // (or any other non-signature string) as the token.
  it("rejects an arbitrary string such as the upload slug", () => {
    expect(isValidHostToken("booking-1", "some-upload-slug")).toBe(false);
  });

  // timingSafeEqual throws rather than returning false on a length mismatch,
  // so the length guard has to come first or this becomes a 500.
  it("returns false rather than throwing on a wrong-length token", () => {
    expect(() => isValidHostToken("booking-1", "abc")).not.toThrow();
    expect(isValidHostToken("booking-1", "abc")).toBe(false);
  });

  it("rejects a token of the right length but wrong content", () => {
    const real = generateHostToken("booking-1");
    const forged = real.slice(0, -1) + (real.endsWith("a") ? "b" : "a");
    expect(forged).toHaveLength(real.length);
    expect(isValidHostToken("booking-1", forged)).toBe(false);
  });
});

describe("hostTokenFromRequest", () => {
  it("reads the t query param", () => {
    const req = { url: "https://example.com/api/events/slug/cancel?t=abc123" };
    expect(hostTokenFromRequest(req)).toBe("abc123");
  });

  it("returns null when absent", () => {
    expect(hostTokenFromRequest({ url: "https://example.com/api/events/slug/cancel" })).toBe(null);
  });

  it("round-trips a real token through a URL", () => {
    const token = generateHostToken("booking-1");
    const req = { url: `https://example.com/api/events/slug/cancel?t=${encodeURIComponent(token)}` };
    expect(isValidHostToken("booking-1", hostTokenFromRequest(req))).toBe(true);
  });
});
