import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GET, PATCH } from "./route";

function makeRequest() {
  return { headers: { get: () => null } };
}

function jsonRequest(body) {
  return { json: async () => body, headers: { get: () => null } };
}

const BOOKING = {
  id: "b1",
  host_name: "Jordan",
  event_type: "Wedding",
  event_date: "2026-12-25",
  upload_slug: "slug-1",
  status: "collecting",
  tier: "standard",
  uploads_closed_at: null,
  social_style: null,
  deadline_extension_hours: 0,
  processing_started_at: null,
};

describe("GET /api/events/[eventId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("returns the event with its upload count", async () => {
    sb.mockResponse({ data: BOOKING, error: null }); // booking select
    sb.mockResponse({ count: 7, data: null, error: null }); // uploads count
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json).toEqual({ event: BOOKING, uploadCount: 7 });
  });

  it("defaults the upload count to 0 when the count comes back null", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ count: null, data: null, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.uploadCount).toBe(0);
  });
});

describe("PATCH /api/events/[eventId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects an invalid social style", async () => {
    const res = await PATCH(jsonRequest({ socialStyle: "chaotic" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("allows clearing the social style with null", async () => {
    sb.mockResponse({ data: { social_style: null }, error: null });
    const res = await PATCH(jsonRequest({ socialStyle: null }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: null });
    const res = await PATCH(jsonRequest({ socialStyle: "cinematic" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("updates the social style and returns it", async () => {
    sb.mockResponse({ data: { social_style: "retro" }, error: null });
    const res = await PATCH(jsonRequest({ socialStyle: "retro" }), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json).toEqual({ success: true, social_style: "retro" });
    const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ social_style: "retro" });
  });
});
