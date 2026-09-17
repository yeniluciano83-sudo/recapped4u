import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { POST } from "./route";

function jsonRequest(body) {
  return { json: async () => body };
}

describe("POST /api/promo-codes/check", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("reports a real, active, unrestricted code as valid with no tier restriction", async () => {
    sb.mockResponse({ data: { active: true, tier_restriction: null, max_uses: null, use_count: 4 }, error: null });

    const res = await POST(jsonRequest({ code: "founders1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ valid: true, tierRestriction: null });
    const eqCall = sb.callLog[0].calls.find((c) => c.method === "eq");
    expect(eqCall.args).toEqual(["code", "FOUNDERS1"]); // trimmed + uppercased before lookup
  });

  it("reports a tier-restricted code's restriction", async () => {
    sb.mockResponse({ data: { active: true, tier_restriction: "premium", max_uses: 1, use_count: 0 }, error: null });

    const res = await POST(jsonRequest({ code: "comp1" }));
    const json = await res.json();

    expect(json).toEqual({ valid: true, tierRestriction: "premium" });
  });

  it("reports an exhausted single-use code as invalid, without leaking why", async () => {
    sb.mockResponse({ data: { active: true, tier_restriction: "premium", max_uses: 1, use_count: 1 }, error: null });

    const res = await POST(jsonRequest({ code: "comp1" }));
    const json = await res.json();

    expect(json).toEqual({ valid: false });
  });

  it("reports a deactivated code as invalid", async () => {
    sb.mockResponse({ data: { active: false, tier_restriction: null, max_uses: null, use_count: 0 }, error: null });

    const res = await POST(jsonRequest({ code: "OLDCODE" }));
    const json = await res.json();

    expect(json).toEqual({ valid: false });
  });

  it("reports a nonexistent code as invalid", async () => {
    sb.mockResponse({ data: null, error: null });

    const res = await POST(jsonRequest({ code: "NOPE" }));
    const json = await res.json();

    expect(json).toEqual({ valid: false });
  });

  it("reports an empty/whitespace-only code as invalid without touching the database", async () => {
    const res = await POST(jsonRequest({ code: "   " }));
    const json = await res.json();

    expect(json).toEqual({ valid: false });
    expect(sb.callLog.length).toBe(0);
  });

  it("reports invalid rather than erroring if the lookup itself fails", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });

    const res = await POST(jsonRequest({ code: "FOUNDERS1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ valid: false });
  });
});
