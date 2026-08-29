import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { PATCH } from "./route";

function jsonRequest(body) {
  return { json: async () => body, headers: { get: () => null } };
}

describe("PATCH /api/gallery/[bookingId]/template", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects a template that isn't implemented on the gallery page", async () => {
    const res = await PATCH(jsonRequest({ template: "fullbleed" }), { params: { bookingId: "b1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it.each(["grid", "masonry", "slideshow", "polaroid"])("accepts the %s template", async (template) => {
    sb.mockResponse({ data: { gallery_template: template }, error: null });
    const res = await PATCH(jsonRequest({ template }), { params: { bookingId: "b1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, gallery_template: template });
  });

  it("returns 500 when the update throws", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await PATCH(jsonRequest({ template: "grid" }), { params: { bookingId: "b1" } });
    expect(res.status).toBe(500);
  });
});
