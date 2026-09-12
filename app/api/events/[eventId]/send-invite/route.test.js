import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/email", () => ({ sendGuestInviteEmail: vi.fn(async () => {}) }));

import { supabase } from "@/lib/supabase";
import { sendGuestInviteEmail } from "@/lib/email";
import { POST } from "./route";

function jsonRequest(body, url = guestUrl()) {
  return { json: async () => body, url, headers: { get: () => null } };
}

const BOOKING = { id: "b1", host_name: "Jordan Smith", event_type: "Wedding", event_date: "2026-06-14", event_time: "17:30", venue: "The Grand Hall" };

describe("POST /api/events/[eventId]/send-invite", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    sendGuestInviteEmail.mockClear();
    process.env.APP_URL = "https://test.example";
  });

  it("rejects a request with no host token", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(jsonRequest({ emails: ["guest@example.com"] }, guestUrl()), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(403);
    expect(sendGuestInviteEmail).not.toHaveBeenCalled();
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(jsonRequest({ emails: ["guest@example.com"] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("rejects an empty guest list", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(jsonRequest({ emails: [] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects malformed email addresses", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(jsonRequest({ emails: ["not-an-email"] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(sendGuestInviteEmail).not.toHaveBeenCalled();
  });

  it("caps how many guests can be emailed in one request", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const emails = Array.from({ length: 26 }, (_, i) => `guest${i}@example.com`);
    const res = await POST(jsonRequest({ emails }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(sendGuestInviteEmail).not.toHaveBeenCalled();
  });

  it("dedupes repeated addresses before sending", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(jsonRequest({ emails: ["guest@example.com", " guest@example.com "] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(sendGuestInviteEmail).toHaveBeenCalledTimes(1);
  });

  it("sends the invite image URL and guest upload URL for the booking's own slug", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(jsonRequest({ emails: ["guest@example.com"] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const call = sendGuestInviteEmail.mock.calls[0][0];
    expect(call.to).toBe("guest@example.com");
    expect(call.eventName).toBe("Jordan Smith's Wedding");
    expect(call.uploadUrl).toBe("https://test.example/event/slug-1");
    expect(call.inviteImageUrl).toBe("https://test.example/api/invite/slug-1");
    expect(call.venue).toBe("The Grand Hall");
  });

  it("reports a partial failure without failing the whole request", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sendGuestInviteEmail.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => { throw new Error("bounced"); });
    const res = await POST(jsonRequest({ emails: ["good@example.com", "bad@example.com"] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("returns 500 when every send fails", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sendGuestInviteEmail.mockImplementation(async () => { throw new Error("bounced"); });
    const res = await POST(jsonRequest({ emails: ["guest@example.com"] }, hostUrl("b1")), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });
});
