import { describe, it, expect } from "vitest";
import { TIER_PRICES, SOCIAL_CUT_ELIGIBLE_TIERS, ROAST_FULL_LEVELS_TIERS, roastAddonPriceCents } from "./pricing";

describe("TIER_PRICES", () => {
  it("has the expected amount for every tier", () => {
    expect(TIER_PRICES.free.amount).toBe(0);
    expect(TIER_PRICES.standard.amount).toBe(3500);
    expect(TIER_PRICES.premium.amount).toBe(7500);
    expect(TIER_PRICES.keepsake.amount).toBe(9500);
  });
});

describe("SOCIAL_CUT_ELIGIBLE_TIERS / ROAST_FULL_LEVELS_TIERS", () => {
  it("only includes Spotlight and Luxe", () => {
    expect(SOCIAL_CUT_ELIGIBLE_TIERS).toEqual(["premium", "keepsake"]);
    expect(ROAST_FULL_LEVELS_TIERS).toEqual(["premium", "keepsake"]);
  });
});

describe("roastAddonPriceCents", () => {
  it("charges Spotlight for Lukewarm or Hot, but not Light", () => {
    expect(roastAddonPriceCents("premium", "light")).toBe(0);
    expect(roastAddonPriceCents("premium", "lukewarm")).toBe(2000);
    expect(roastAddonPriceCents("premium", "hot")).toBe(2000);
  });

  it("is always free on Luxe, regardless of level", () => {
    expect(roastAddonPriceCents("keepsake", "light")).toBe(0);
    expect(roastAddonPriceCents("keepsake", "lukewarm")).toBe(0);
    expect(roastAddonPriceCents("keepsake", "hot")).toBe(0);
  });

  it("is free on tiers that don't charge for roast intensity", () => {
    expect(roastAddonPriceCents("free", "hot")).toBe(0);
    expect(roastAddonPriceCents("standard", "hot")).toBe(0);
  });
});
