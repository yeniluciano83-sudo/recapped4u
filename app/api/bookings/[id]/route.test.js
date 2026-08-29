import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { PATCH } from "./route";

function jsonRequest(body) {
  return { json: async () => body, headers: { get: () => null } };
}

describe("PATCH /api/bookings/[id]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects a status not in the allowed set", async () => {
    const res = await PATCH(jsonRequest({ status: "cancelled" }), { params: { id: "b1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it.each(["booked", "collecting", "analyzing", "editing", "delivered"])(
    "accepts %s as a valid status",
    async (status) => {
      sb.mockResponse({ data: { id: "b1", status }, error: null });
      const res = await PATCH(jsonRequest({ status }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ status });
    }
  );

  it("returns the updated booking on success", async () => {
    sb.mockResponse({ data: { id: "b1", status: "editing" }, error: null });
    const res = await PATCH(jsonRequest({ status: "editing" }), { params: { id: "b1" } });
    const json = await res.json();
    expect(json).toEqual({ success: true, booking: { id: "b1", status: "editing" } });
  });

  it("returns 500 when the update fails", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await PATCH(jsonRequest({ status: "editing" }), { params: { id: "b1" } });
    expect(res.status).toBe(500);
  });
});
