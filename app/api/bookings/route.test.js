import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

const stripeMocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { checkout: { sessions: { create: stripeMocks.sessionsCreate } } };
  }),
}));
vi.mock("@/lib/email", () => ({
  sendConfirmBookingEmail: vi.fn(),
}));
vi.mock("@/lib/confirmToken", () => ({
  generateConfirmToken: vi.fn(() => "fake-token"),
}));

import { supabase } from "@/lib/supabase";
import { sendConfirmBookingEmail } from "@/lib/email";
import { generateConfirmToken } from "@/lib/confirmToken";
import { POST } from "./route";

function jsonRequest(body) {
  return { json: async () => body };
}

const BASE_BODY = {
  hostName: "Jordan Smith",
  email: "jordan@example.com",
  eventType: "Party",
  eventDate: "2026-12-25",
  tier: "standard",
};

describe("POST /api/bookings", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    stripeMocks.sessionsCreate.mockReset();
    sendConfirmBookingEmail.mockReset();
    generateConfirmToken.mockReset().mockReturnValue("fake-token");
    process.env.APP_URL = "https://test.example";
  });

  it("rejects a request missing a required field, without touching the database", async () => {
    const res = await POST(jsonRequest({ ...BASE_BODY, hostName: "" }));
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("rejects a whitespace-only hostName", async () => {
    const res = await POST(jsonRequest({ ...BASE_BODY, hostName: "   " }));
    expect(res.status).toBe(400);
  });

  it("holds a free-tier booking at pending_confirmation, sends the confirm email, and never touches Stripe", async () => {
    sb.mockResponse({ data: { id: "booking-1" }, error: null }); // insert().select().single()
    sb.mockResponse({ data: null, error: null }); // update -> pending_confirmation

    const res = await POST(jsonRequest({ ...BASE_BODY, tier: "free" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ bookingId: "booking-1" });
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
    expect(sendConfirmBookingEmail).toHaveBeenCalledTimes(1);
    expect(sendConfirmBookingEmail.mock.calls[0][0]).toMatchObject({
      to: "jordan@example.com",
      hostName: "Jordan Smith",
    });

    const insertCall = sb.callLog[0].calls.find((c) => c.method === "insert");
    expect(insertCall.args[0].status).toBe("booked");
    const pendingUpdateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(pendingUpdateCall.args[0].status).toBe("pending_confirmation");
  });

  it("still succeeds and returns the bookingId even if generating the confirm token throws", async () => {
    sb.mockResponse({ data: { id: "booking-1" }, error: null });
    sb.mockResponse({ data: null, error: null });
    generateConfirmToken.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await POST(jsonRequest({ ...BASE_BODY, tier: "free" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ bookingId: "booking-1" });
    expect(sendConfirmBookingEmail).not.toHaveBeenCalled();
  });

  it("creates a Stripe checkout session for a paid tier and returns the checkout URL", async () => {
    sb.mockResponse({ data: { id: "booking-2" }, error: null }); // insert
    sb.mockResponse({ data: null, error: null }); // update stripe_session_id
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/abc" });

    const res = await POST(jsonRequest({ ...BASE_BODY, tier: "standard" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ bookingId: "booking-2", checkoutUrl: "https://checkout.stripe.com/abc" });

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items).toHaveLength(1);
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(3500);
    expect(sessionArgs.metadata.booking_id).toBe("booking-2");
  });

  it("adds a Roast Reel line item only when the tier/level actually charges for it (Spotlight, Lukewarm+)", async () => {
    sb.mockResponse({ data: { id: "booking-3" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_456", url: "https://checkout.stripe.com/def" });

    await POST(jsonRequest({ ...BASE_BODY, tier: "premium", roastEnabled: true, roastLevel: "hot" }));

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items).toHaveLength(2);
    expect(sessionArgs.line_items[1].price_data.unit_amount).toBe(2000);
  });

  it("never adds a Roast Reel line item on Luxe, which is complimentary at every intensity", async () => {
    sb.mockResponse({ data: { id: "booking-4" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_789", url: "https://checkout.stripe.com/ghi" });

    await POST(jsonRequest({ ...BASE_BODY, tier: "keepsake", roastEnabled: true, roastLevel: "hot" }));

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items).toHaveLength(1);
  });

  it("returns 500 and never calls Stripe when the booking insert fails", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });

    const res = await POST(jsonRequest(BASE_BODY));

    expect(res.status).toBe(500);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
