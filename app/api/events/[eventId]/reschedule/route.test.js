import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/email", () => ({
  sendRescheduleConfirmation: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { sendRescheduleConfirmation } from "@/lib/email";
import { GET, POST } from "./route";

function makeRequest(body) {
  return {
    headers: { get: () => null },
    json: async () => body,
  };
}

// "Now" is fixed so hoursUntilEventDate is deterministic: 2026-06-20 is
// comfortably >= 24h out, 2026-06-15 is inside the 24h window.
const NOW = new Date("2026-06-15T12:00:00Z");

const BOOKING = {
  id: "b1",
  email: "jordan@example.com",
  host_name: "Jordan",
  status: "collecting",
  event_date: "2026-06-20",
};

describe("GET /api/events/[eventId]/reschedule", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("is eligible while collecting and at least 24h out", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.rescheduleEligible).toBe(true);
  });

  it.each(["analyzing", "editing", "awaiting_roast_approval", "delivered", "cancelled"])(
    "is ineligible once status is %s, even with plenty of time before the event",
    async (status) => {
      sb.mockResponse({ data: { ...BOOKING, status }, error: null });
      const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
      const json = await res.json();
      expect(json.rescheduleEligible).toBe(false);
    }
  );

  it("is ineligible once inside the 24h window, even while still collecting", async () => {
    sb.mockResponse({ data: { ...BOOKING, event_date: "2026-06-15" }, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.rescheduleEligible).toBe(false);
  });
});

describe("POST /api/events/[eventId]/reschedule", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    sendRescheduleConfirmation.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a missing new date without touching the database", async () => {
    const res = await POST(makeRequest({}), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("rejects an unparseable new date without touching the database", async () => {
    const res = await POST(makeRequest({ newDate: "not-a-date" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it.each(["analyzing", "editing", "awaiting_roast_approval", "delivered", "cancelled"])(
    "blocks rescheduling once status is %s",
    async (status) => {
      sb.mockResponse({ data: { ...BOOKING, status }, error: null });
      const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
      expect(res.status).toBe(400);
    }
  );

  it("blocks rescheduling once inside 24h of the current event date", async () => {
    sb.mockResponse({ data: { ...BOOKING, event_date: "2026-06-15" }, error: null });
    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects a new date less than 24h from now", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    const res = await POST(makeRequest({ newDate: "2026-06-15" }), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/at least 24 hours/);
  });

  it("returns 409 when the status changed out from under the reschedule (lost the claim race)", async () => {
    sb.mockResponse({ data: BOOKING, error: null }); // select
    sb.mockResponse({ data: null, error: null }); // guarded update matches nothing
    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(409);
  });

  it("returns 500 when the update itself fails", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });

  it("reschedules a valid request and sends the confirmation email", async () => {
    sb.mockResponse({ data: BOOKING, error: null }); // select
    sb.mockResponse({ data: { id: "b1" }, error: null }); // guarded update succeeds

    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, newDate: "2026-06-25" });

    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ event_date: "2026-06-25" });

    expect(sendRescheduleConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jordan@example.com", oldDate: "2026-06-20", newDate: "2026-06-25" })
    );
  });

  it("still reschedules and returns success even if the confirmation email throws", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });
    sendRescheduleConfirmation.mockRejectedValue(new Error("email service down"));

    const res = await POST(makeRequest({ newDate: "2026-06-25" }), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
