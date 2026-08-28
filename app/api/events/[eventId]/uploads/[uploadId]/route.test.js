import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { PATCH } from "./route";

function jsonRequest(body) {
  return { json: async () => body, headers: { get: () => null } };
}

describe("PATCH /api/events/[eventId]/uploads/[uploadId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(404);
  });

  it("rejects a request with no recognized fields", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard" }, error: null });
    const res = await PATCH(jsonRequest({ somethingElse: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
  });

  it("toggles mustInclude on any tier", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: { must_include: true, must_include_social: false }, error: null });

    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, mustInclude: true, mustIncludeSocial: false });
    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ must_include: true });
  });

  it("rejects mustIncludeSocial on a tier without social cuts", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard" }, error: null });
    const res = await PATCH(jsonRequest({ mustIncludeSocial: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
    // No uploads table call should have been attempted -- only the booking select.
    expect(sb.callLog.length).toBe(1);
  });

  it("allows mustIncludeSocial on Spotlight and Luxe", async () => {
    for (const tier of ["premium", "keepsake"]) {
      sb.mockResponse({ data: { id: "b1", tier }, error: null });
      sb.mockResponse({ data: { must_include: false, must_include_social: true }, error: null });

      const res = await PATCH(jsonRequest({ mustIncludeSocial: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
      expect(res.status).toBe(200);
    }
  });

  it("scopes the update to the upload's own booking, not just its id", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: { must_include: true, must_include_social: false }, error: null });

    await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });

    const eqCalls = sb.callLog[1].calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["booking_id", "b1"] });
  });

  it("returns 404 when the upload doesn't belong to this booking", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: null, error: null }); // maybeSingle finds nothing

    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "wrong-upload" } });
    expect(res.status).toBe(404);
  });
});
