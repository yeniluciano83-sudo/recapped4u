import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { POST } from "./route";

function makeRequest() {
  return { url: hostUrl(), headers: { get: () => null } };
}

const BASE_BOOKING = { id: "b1", tier: "keepsake", status: "collecting", uploads_closed_at: null, deadline_extension_hours: 0 };

describe("POST /api/events/[eventId]/extend-deadline", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  // The extension is one-shot; a guest with the QR could burn it before the
  // host ever wanted it.
  it("rejects a request with no host token", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "keepsake", status: "collecting", uploads_closed_at: null, deadline_extension_hours: 0 }, error: null });
    const res = await POST({ url: guestUrl(), headers: { get: () => null } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(403);
  });

  it("is a Luxe-only perk -- rejects every other tier", async () => {
    for (const tier of ["free", "standard", "premium"]) {
      sb.mockResponse({ data: { ...BASE_BOOKING, tier }, error: null });
      const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
      expect(res.status).toBe(400);
    }
  });

  it("rejects extending a booking that isn't collecting", async () => {
    sb.mockResponse({ data: { ...BASE_BOOKING, status: "editing" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects extending once uploads are already closed", async () => {
    sb.mockResponse({ data: { ...BASE_BOOKING, uploads_closed_at: "2026-01-01T00:00:00.000Z" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("is one-time only -- a second extension request reports alreadyExtended instead of stacking", async () => {
    sb.mockResponse({ data: { ...BASE_BOOKING, deadline_extension_hours: 48 }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deadlineExtensionHours: 48, alreadyExtended: true });
    // No update attempted -- only the initial select happened.
    expect(sb.callLog.length).toBe(1);
  });

  it("extends the deadline by 48 hours on a first request", async () => {
    sb.mockResponse({ data: BASE_BOOKING, error: null });
    sb.mockResponse({ data: null, error: null }); // update

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deadlineExtensionHours: 48 });

    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ deadline_extension_hours: 48 });
  });

  it("returns 500 when the update fails", async () => {
    sb.mockResponse({ data: BASE_BOOKING, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });
});
