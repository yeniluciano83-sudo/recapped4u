import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GET, POST } from "./route";

function jsonRequest(body, url = guestUrl()) {
  return { json: async () => body, url, headers: { get: () => null } };
}

const BOOKING = { id: "b1" };

describe("POST /api/events/[eventId]/rsvp", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects an invalid response value", async () => {
    const res = await POST(jsonRequest({ guestName: "Jordan", response: "definitely" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(jsonRequest({ guestName: "Jordan", response: "yes" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("upserts a named guest's response, keyed on booking + name", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ data: null, error: null });
    const res = await POST(jsonRequest({ guestName: "Jordan", response: "yes" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const rsvpCall = sb.callLog[1];
    expect(rsvpCall.table).toBe("rsvps");
    const upsertCall = rsvpCall.calls.find((c) => c.method === "upsert");
    expect(upsertCall.args[0]).toMatchObject({ booking_id: "b1", guest_name: "Jordan", response: "yes" });
    expect(upsertCall.args[1]).toEqual({ onConflict: "booking_id,guest_name" });
  });

  it("inserts (never upserts) an anonymous response", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ data: null, error: null });
    const res = await POST(jsonRequest({ guestName: "", response: "maybe" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const rsvpCall = sb.callLog[1];
    const insertCall = rsvpCall.calls.find((c) => c.method === "insert");
    const upsertCall = rsvpCall.calls.find((c) => c.method === "upsert");
    expect(insertCall.args[0]).toMatchObject({ booking_id: "b1", guest_name: null, response: "maybe" });
    expect(upsertCall).toBeUndefined();
  });

  it("returns 500 when the write fails", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await POST(jsonRequest({ guestName: "Jordan", response: "no" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/events/[eventId]/rsvp", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects a request with no host token", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await GET({ url: guestUrl(), headers: { get: () => null } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(403);
  });

  it("returns counts and the response list for a valid host token", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({
      data: [
        { guest_name: "Jordan", response: "yes", created_at: "2026-01-02" },
        { guest_name: "Sam", response: "maybe", created_at: "2026-01-01" },
        { guest_name: null, response: "yes", created_at: "2026-01-03" },
      ],
      error: null,
    });
    const res = await GET({ url: hostUrl("b1"), headers: { get: () => null } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ yes: 2, no: 0, maybe: 1 });
    expect(body.responses).toHaveLength(3);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET({ url: hostUrl("b1"), headers: { get: () => null } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });
});
