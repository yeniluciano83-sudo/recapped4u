import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

const stripeMocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { webhooks: { constructEvent: stripeMocks.constructEvent } };
  }),
}));
vi.mock("@/lib/email", () => ({
  sendBookingConfirmation: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { sendBookingConfirmation } from "@/lib/email";
import { POST } from "./route";

function webhookRequest(rawBody, signature = "sig_test") {
  return {
    text: async () => rawBody,
    headers: { get: (name) => (name === "stripe-signature" ? signature : null) },
  };
}

const SESSION = {
  metadata: { booking_id: "booking-1" },
  currency: "usd",
  amount_total: 7500,
};

const BOOKED_ROW = {
  id: "booking-1",
  email: "jordan@example.com",
  host_name: "Jordan",
  event_date: "2026-12-25",
  event_type: "Party",
  tier: "premium",
  guest_count: 40,
  style: "cinematic",
  roast_enabled: false,
  upload_slug: "slug-123",
};

describe("POST /api/webhooks/stripe", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    stripeMocks.constructEvent.mockReset();
    sendBookingConfirmation.mockReset();
    process.env.APP_URL = "https://test.example";
  });

  it("rejects a request with an invalid signature, writing nothing to the database", async () => {
    stripeMocks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const res = await POST(webhookRequest("{}", "bad-sig"));

    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
  });

  it("no-ops on an event type it doesn't handle", async () => {
    stripeMocks.constructEvent.mockReturnValue({ type: "payment_intent.succeeded", data: { object: {} } });

    const res = await POST(webhookRequest("{}"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(sb.callLog.length).toBe(0);
  });

  it("marks a booked booking paid/collecting and emails the real charged amount", async () => {
    stripeMocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: SESSION },
    });
    sb.mockResponse({ data: BOOKED_ROW, error: null });

    const res = await POST(webhookRequest("{}"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });

    const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ stripe_payment_status: "paid", status: "collecting" });
    const statusGuard = sb.callLog[0].calls.filter((c) => c.method === "eq");
    expect(statusGuard).toContainEqual({ method: "eq", args: ["status", "booked"] });

    expect(sendBookingConfirmation).toHaveBeenCalledTimes(1);
    const emailArgs = sendBookingConfirmation.mock.calls[0][0];
    expect(emailArgs.amountPaid).toBe("$75.00");
    expect(emailArgs.uploadUrl).toContain("slug-123");
    expect(emailArgs.to).toBe("jordan@example.com");
  });

  it("is idempotent on a redelivered webhook -- no duplicate email, still a 200", async () => {
    stripeMocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: SESSION },
    });
    // .eq("status", "booked") matches zero rows once the booking has already
    // moved past "booked" -- .single() surfaces that as an error, exactly
    // as it would against the real database on a Stripe retry.
    sb.mockResponse({ data: null, error: { message: "no rows returned" } });

    const res = await POST(webhookRequest("{}"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
  });

  it("does nothing when the session has no booking_id in its metadata", async () => {
    stripeMocks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { metadata: {} } },
    });

    const res = await POST(webhookRequest("{}"));

    expect(res.status).toBe(200);
    expect(sb.callLog.length).toBe(0);
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
  });
});
