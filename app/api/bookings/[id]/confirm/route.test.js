import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/confirmToken", () => ({
  isValidConfirmToken: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendBookingConfirmation: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { isValidConfirmToken } from "@/lib/confirmToken";
import { sendBookingConfirmation } from "@/lib/email";
import { GET } from "./route";

function makeRequest(token) {
  const searchParams = new URLSearchParams(token !== undefined ? { token } : {});
  return {
    url: "https://test.example/api/bookings/booking-1/confirm",
    nextUrl: { searchParams },
  };
}

function locationOf(res) {
  return res.headers.get("location");
}

const PENDING_BOOKING = {
  id: "booking-1",
  status: "pending_confirmation",
  email: "jordan@example.com",
  host_name: "Jordan",
  event_date: "2026-12-25",
  event_type: "Party",
  guest_count: 40,
  tier: "standard",
  style: "cinematic",
  roast_enabled: false,
  upload_slug: "slug-123",
};

describe("GET /api/bookings/[id]/confirm", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    isValidConfirmToken.mockReset();
    sendBookingConfirmation.mockReset();
    process.env.APP_URL = "https://test.example";
  });

  it("redirects to the error page on an invalid token, without touching the database", async () => {
    isValidConfirmToken.mockReturnValue(false);

    const res = await GET(makeRequest("bad-token"), { params: { id: "booking-1" } });

    expect(locationOf(res)).toContain("/booking?confirm_error=1");
    expect(sb.callLog.length).toBe(0);
  });

  it("redirects to the error page when the booking can't be found", async () => {
    isValidConfirmToken.mockReturnValue(true);
    sb.mockResponse({ data: null, error: null });

    const res = await GET(makeRequest("good-token"), { params: { id: "booking-1" } });

    expect(locationOf(res)).toContain("/booking?confirm_error=1");
  });

  it("redirects straight to success without re-sending the email if the link is clicked twice", async () => {
    isValidConfirmToken.mockReturnValue(true);
    sb.mockResponse({ data: { ...PENDING_BOOKING, status: "collecting" }, error: null });

    const res = await GET(makeRequest("good-token"), { params: { id: "booking-1" } });

    expect(locationOf(res)).toContain("/booking/success?booking_id=booking-1");
    expect(sendBookingConfirmation).not.toHaveBeenCalled();
    // Only the initial select happened -- no status update was attempted.
    expect(sb.callLog.length).toBe(1);
  });

  it("activates a pending booking, sends the confirmation, and redirects to success", async () => {
    isValidConfirmToken.mockReturnValue(true);
    sb.mockResponse({ data: PENDING_BOOKING, error: null }); // select
    sb.mockResponse({ data: null, error: null }); // update -> collecting

    const res = await GET(makeRequest("good-token"), { params: { id: "booking-1" } });

    expect(locationOf(res)).toContain("/booking/success?booking_id=booking-1");
    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ status: "collecting" });

    expect(sendBookingConfirmation).toHaveBeenCalledTimes(1);
    const emailArgs = sendBookingConfirmation.mock.calls[0][0];
    expect(emailArgs.amountPaid).toBe("$0.00");
    expect(emailArgs.to).toBe("jordan@example.com");
  });

  it("still redirects to success even if sending the confirmation email throws", async () => {
    isValidConfirmToken.mockReturnValue(true);
    sb.mockResponse({ data: PENDING_BOOKING, error: null });
    sb.mockResponse({ data: null, error: null });
    sendBookingConfirmation.mockRejectedValue(new Error("email service down"));

    const res = await GET(makeRequest("good-token"), { params: { id: "booking-1" } });

    expect(locationOf(res)).toContain("/booking/success?booking_id=booking-1");
  });
});
