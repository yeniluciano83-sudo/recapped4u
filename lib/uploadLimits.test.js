import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getUploadLimit } from "./uploadLimits";

describe("getUploadLimit", () => {
  it("caps Free at 20, matching its curated gallery size", () => {
    expect(getUploadLimit("free")).toBe(20);
  });

  it("caps Highlight at 500", () => {
    expect(getUploadLimit("standard")).toBe(500);
  });

  it("caps Spotlight and Luxe at 2000 (advertised as unlimited)", () => {
    expect(getUploadLimit("premium")).toBe(2000);
    expect(getUploadLimit("keepsake")).toBe(2000);
  });

  it("falls back to the 500-photo default for any unknown tier", () => {
    expect(getUploadLimit("something-new")).toBe(500);
    expect(getUploadLimit(undefined)).toBe(500);
  });
});

// These numbers exist twice on purpose -- the route needs them to reject early
// without a round trip, and the uploads_enforce_cap trigger needs them to be
// the copy that's actually binding under concurrency. Two sources of truth are
// tolerable only while something proves they agree; that's this.
describe("the cap in migration 033 matches lib/uploadLimits.js", () => {
  const sql = readFileSync(
    path.join(import.meta.dirname, "..", "migrations", "033_enforce_upload_cap.sql"),
    "utf8"
  );

  // `when 'free' then 20` -> { free: 20 }
  const sqlCaps = Object.fromEntries(
    [...sql.matchAll(/when\s+'([a-z_]+)'\s+then\s+(\d+)/gi)].map(([, tier, cap]) => [tier, Number(cap)])
  );
  const sqlDefault = Number((sql.match(/else\s+(\d+)\s*\n?\s*end/i) || [])[1]);

  it("parses the trigger's CASE arms at all -- guards against testing nothing", () => {
    expect(Object.keys(sqlCaps).sort()).toEqual(["free", "keepsake", "premium", "standard"]);
    expect(sqlDefault).toBeGreaterThan(0);
  });

  it.each(["free", "standard", "premium", "keepsake"])("agrees on %s", (tier) => {
    expect(sqlCaps[tier]).toBe(getUploadLimit(tier));
  });

  it("agrees on the fallback for an unrecognised tier", () => {
    expect(sqlDefault).toBe(getUploadLimit("some-tier-that-does-not-exist"));
  });

  it("still raises with the SQLSTATE the confirm route branches on", () => {
    // If this string changes, confirm/route.js stops recognising a full event
    // and starts returning 500s to guests instead of a readable message.
    expect(sql).toMatch(/errcode\s*=\s*'UPCAP'/);
  });
});
