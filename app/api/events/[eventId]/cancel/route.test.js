import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

const stripeMocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  refundsCreate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      checkout: { sessions: { retrieve: stripeMocks.retrieve } },
      refunds: { create: stripeMocks.refundsCreate },
    };
  }),
}));
vi.mock("@/lib/email", () => ({
  sendCancellationConfirmation: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { sendCancellationConfirmation } from "@/lib/email";
import { GET, POST } from "./route";

function makeRequest() {
  return { headers: { get: () => null } };
}

// "Now" is fixed so hoursUntilEventDate/isAtLeast24HoursOut (lib/eventDate.js)
// are deterministic: 2026-06-16 is exactly 24h+ out, 2026-06-15T18:00 is not.
const NOW = new Date("2026-06-15T12:00:00Z");

const PAID_BOOKING = {
  id: "b1",
  email: "jordan@example.com",
  host_name: "Jordan",
  tier: "standard",
  status: "collecting",
  cancelled_at: null,
  stripe_payment_status: "paid",
  stripe_session_id: "cs_test_123",
  event_date: "2026-06-20", // comfortably >= 24h out from NOW
};

describe("GET /api/events/[eventId]/cancel", () => {
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

  it("reports refund-eligible when the event is at least 24h out", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, event_date: "2026-06-20" }, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.refundEligible).toBe(true);
  });

  it("reports refund-ineligible once inside the 24h window", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, event_date: "2026-06-15" }, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.refundEligible).toBe(false);
  });
});

describe("POST /api/events/[eventId]/cancel", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    stripeMocks.retrieve.mockReset();
    stripeMocks.refundsCreate.mockReset();
    sendCancellationConfirmation.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("short-circuits with alreadyCancelled if the event is already cancelled -- no double-processing", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, status: "cancelled" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json).toEqual({ success: true, alreadyCancelled: true });
    expect(sb.callLog.length).toBe(1); // only the initial select
  });

  it.each(["analyzing", "editing", "awaiting_roast_approval", "delivered"])(
    "blocks cancellation once the booking is %s",
    async (status) => {
      sb.mockResponse({ data: { ...PAID_BOOKING, status }, error: null });
      const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
      expect(res.status).toBe(400);
    }
  );

  it("returns 409 when the status changed out from under the cancel (lost the claim race)", async () => {
    sb.mockResponse({ data: PAID_BOOKING, error: null }); // select
    sb.mockResponse({ data: null, error: null }); // guarded update matches nothing
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(409);
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it("returns 500 when the cancellation update itself fails", async () => {
    sb.mockResponse({ data: PAID_BOOKING, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });

  it("never refunds a Free tier booking, even if paid and refund-eligible -- Free never actually charges", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, tier: "free" }, error: null }); // select
    sb.mockResponse({ data: { id: "b1" }, error: null }); // claim update succeeds

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json).toEqual({ success: true, refunded: false, amountRefunded: null });
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it("refunds a paid, refund-eligible booking and marks it refunded", async () => {
    sb.mockResponse({ data: PAID_BOOKING, error: null }); // select
    sb.mockResponse({ data: { id: "b1" }, error: null }); // claim update
    sb.mockResponse({ data: null, error: null }); // stripe_payment_status -> refunded update
    stripeMocks.retrieve.mockResolvedValue({ payment_intent: "pi_123" });
    stripeMocks.refundsCreate.mockResolvedValue({ amount: 3500, currency: "usd" });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json).toEqual({ success: true, refunded: true, amountRefunded: "$35.00" });
    expect(stripeMocks.refundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_123" });
    const statusUpdateCall = sb.callLog[2].calls.find((c) => c.method === "update");
    expect(statusUpdateCall.args[0]).toEqual({ stripe_payment_status: "refunded" });
  });

  it("does not refund a paid booking inside the 24h window", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, event_date: "2026-06-15" }, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json).toEqual({ success: true, refunded: false, amountRefunded: null });
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it("does not refund when stripe_payment_status isn't actually 'paid'", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, stripe_payment_status: "unpaid" }, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json.refunded).toBe(false);
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it("does not attempt a refund when there's no stripe_session_id on file", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, stripe_session_id: null }, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json.refunded).toBe(false);
    expect(stripeMocks.retrieve).not.toHaveBeenCalled();
  });

  it("does not refund when the Stripe session has no payment_intent", async () => {
    sb.mockResponse({ data: PAID_BOOKING, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });
    stripeMocks.retrieve.mockResolvedValue({ payment_intent: null });

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json.refunded).toBe(false);
    expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
  });

  it("still cancels and returns success even if the confirmation email throws", async () => {
    sb.mockResponse({ data: { ...PAID_BOOKING, tier: "free" }, error: null });
    sb.mockResponse({ data: { id: "b1" }, error: null });
    sendCancellationConfirmation.mockRejectedValue(new Error("email service down"));

    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
