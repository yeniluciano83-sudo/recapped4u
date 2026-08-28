import { describe, it, expect, beforeEach } from "vitest";
import { generateConfirmToken, isValidConfirmToken } from "./confirmToken";

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-signing-secret";
});

describe("generateConfirmToken", () => {
  it("is deterministic for the same booking id", () => {
    expect(generateConfirmToken("booking-1")).toBe(generateConfirmToken("booking-1"));
  });

  it("differs between booking ids", () => {
    expect(generateConfirmToken("booking-1")).not.toBe(generateConfirmToken("booking-2"));
  });

  it("differs when the signing secret differs", () => {
    const tokenA = generateConfirmToken("booking-1");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-secret";
    const tokenB = generateConfirmToken("booking-1");
    expect(tokenA).not.toBe(tokenB);
  });
});

describe("isValidConfirmToken", () => {
  it("accepts the token generated for that exact booking id", () => {
    const token = generateConfirmToken("booking-1");
    expect(isValidConfirmToken("booking-1", token)).toBe(true);
  });

  it("rejects a token generated for a different booking id", () => {
    const token = generateConfirmToken("booking-2");
    expect(isValidConfirmToken("booking-1", token)).toBe(false);
  });

  it("rejects a tampered token of the same length", () => {
    const token = generateConfirmToken("booking-1");
    const tampered = "f" + token.slice(1);
    expect(isValidConfirmToken("booking-1", tampered)).toBe(false);
  });

  it("rejects a token of the wrong length without throwing", () => {
    expect(() => isValidConfirmToken("booking-1", "too-short")).not.toThrow();
    expect(isValidConfirmToken("booking-1", "too-short")).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(isValidConfirmToken("booking-1", null)).toBe(false);
    expect(isValidConfirmToken("booking-1", undefined)).toBe(false);
    expect(isValidConfirmToken("booking-1", "")).toBe(false);
  });
});
