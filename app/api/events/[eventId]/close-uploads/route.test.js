import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { POST } from "./route";

function makeRequest() {
  return { url: hostUrl(), headers: { get: () => null } };
}

describe("POST /api/events/[eventId]/close-uploads", () => {
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

  // A guest with the QR could otherwise cut off collection mid-event.
  it("rejects a request with no host token", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", uploads_closed_at: null }, error: null });
    const res = await POST({ url: guestUrl(), headers: { get: () => null } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(403);
  });

  it("rejects closing uploads on a booking that isn't collecting", async () => {
    sb.mockResponse({ data: { id: "b1", status: "booked", uploads_closed_at: null }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("is idempotent -- closing an already-closed event returns the original timestamp instead of erroring", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", uploads_closed_at: "2026-01-01T00:00:00.000Z" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, uploadsClosedAt: "2026-01-01T00:00:00.000Z", alreadyClosed: true });
    // No update should have been attempted -- only the initial select happened.
    expect(sb.callLog.length).toBe(1);
  });

  it("closes uploads and stamps the current time", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", uploads_closed_at: null }, error: null });
    sb.mockResponse({ data: null, error: null }); // update

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(typeof json.uploadsClosedAt).toBe("string");

    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0].uploads_closed_at).toBe(json.uploadsClosedAt);
  });

  it("returns 500 when the update fails", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", uploads_closed_at: null }, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });
});
