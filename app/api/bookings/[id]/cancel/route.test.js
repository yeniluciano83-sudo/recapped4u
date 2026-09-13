import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
// The actual cancel/refund/email logic is lib/cancelBooking's own job,
// already covered end-to-end by app/api/events/[eventId]/cancel's test
// suite (both routes call the exact same function) -- this route's own
// test only needs to prove it looks the booking up correctly and hands
// off cancelBooking's result untouched.
vi.mock("@/lib/cancelBooking", () => ({ cancelBooking: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { cancelBooking } from "@/lib/cancelBooking";
import { POST } from "./route";

describe("POST /api/bookings/[id]/cancel", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    cancelBooking.mockReset();
  });

  it("returns 404 when the booking can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST({}, { params: { id: "b1" } });
    expect(res.status).toBe(404);
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  it("looks the booking up by its real id (not upload_slug) and delegates to cancelBooking", async () => {
    const booking = { id: "b1", status: "collecting", upload_slug: "slug-1" };
    sb.mockResponse({ data: booking, error: null });
    cancelBooking.mockResolvedValue({ body: { success: true, refunded: true, amountRefunded: "$35.00" }, status: 200 });

    const res = await POST({}, { params: { id: "b1" } });
    const json = await res.json();

    expect(sb.callLog[0].calls.some((c) => c.method === "eq" && c.args[0] === "id" && c.args[1] === "b1")).toBe(true);
    expect(cancelBooking).toHaveBeenCalledWith(booking);
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, refunded: true, amountRefunded: "$35.00" });
  });

  it("passes cancelBooking's own error status straight through (e.g. already processing)", async () => {
    sb.mockResponse({ data: { id: "b1", status: "editing" }, error: null });
    cancelBooking.mockResolvedValue({ body: { error: "This event is already being processed and can't be cancelled online — message us on WhatsApp (+1 (646) 512-9151) and we'll help." }, status: 400 });

    const res = await POST({}, { params: { id: "b1" } });
    expect(res.status).toBe(400);
  });
});
