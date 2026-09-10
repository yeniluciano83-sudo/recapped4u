import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/email", () => ({ sendRescheduleConfirmation: vi.fn(), sendBookingUpdateConfirmation: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { sendRescheduleConfirmation, sendBookingUpdateConfirmation } from "@/lib/email";
import { PATCH } from "./route";

function jsonRequest(body) {
  return { json: async () => body, headers: { get: () => null } };
}

describe("PATCH /api/bookings/[id]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    sendRescheduleConfirmation.mockReset();
    sendBookingUpdateConfirmation.mockReset();
  });

  it("rejects a status not in the allowed set", async () => {
    const res = await PATCH(jsonRequest({ status: "cancelled" }), { params: { id: "b1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it.each(["booked", "collecting", "analyzing", "editing", "delivered"])(
    "accepts %s as a valid status",
    async (status) => {
      sb.mockResponse({ data: { id: "b1", status }, error: null });
      const res = await PATCH(jsonRequest({ status }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ status });
    }
  );

  it("returns the updated booking on success", async () => {
    sb.mockResponse({ data: { id: "b1", status: "editing" }, error: null });
    const res = await PATCH(jsonRequest({ status: "editing" }), { params: { id: "b1" } });
    const json = await res.json();
    expect(json).toEqual({ success: true, booking: { id: "b1", status: "editing" } });
  });

  it("returns 500 when the update fails", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await PATCH(jsonRequest({ status: "editing" }), { params: { id: "b1" } });
    expect(res.status).toBe(500);
  });

  it("rejects a request with nothing recognized to update", async () => {
    const res = await PATCH(jsonRequest({}), { params: { id: "b1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  describe("tier changes (the dashboard's admin equivalent of the self-service upgrade)", () => {
    it("rejects an unrecognized tier", async () => {
      const res = await PATCH(jsonRequest({ tier: "platinum" }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
      expect(sb.callLog.length).toBe(0);
    });

    it.each(["free", "standard", "premium", "keepsake"])("accepts %s as a valid tier", async (tier) => {
      sb.mockResponse({ data: { id: "b1", tier }, error: null });
      const res = await PATCH(jsonRequest({ tier }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
    });

    // Same reasoning as the self-service upgrade webhook: a tier change can
    // raise the upload cap, so a booking that already notified its host at
    // the old cap should be able to notify again at a new, higher one.
    it("resets upload_cap_notified_at when the tier changes", async () => {
      sb.mockResponse({ data: { id: "b1", tier: "premium" }, error: null });
      await PATCH(jsonRequest({ tier: "premium" }), { params: { id: "b1" } });
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ tier: "premium", upload_cap_notified_at: null });
    });
  });

  describe("custom_price_cents", () => {
    it("rejects a negative or non-numeric price", async () => {
      for (const bad of [-100, "not a number", NaN]) {
        const res = await PATCH(jsonRequest({ custom_price_cents: bad }), { params: { id: "b1" } });
        expect(res.status).toBe(400);
      }
      expect(sb.callLog.length).toBe(0);
    });

    it("accepts a valid price", async () => {
      sb.mockResponse({ data: { id: "b1", custom_price_cents: 12000 }, error: null });
      const res = await PATCH(jsonRequest({ custom_price_cents: 12000 }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ custom_price_cents: 12000 });
    });

    it("accepts null to clear a previously-set custom price", async () => {
      sb.mockResponse({ data: { id: "b1", custom_price_cents: null }, error: null });
      const res = await PATCH(jsonRequest({ custom_price_cents: null }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ custom_price_cents: null });
    });
  });

  it("applies tier and custom price together in one request", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "keepsake", custom_price_cents: 15000 }, error: null });
    const res = await PATCH(jsonRequest({ tier: "keepsake", custom_price_cents: 15000 }), { params: { id: "b1" } });
    expect(res.status).toBe(200);
    const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ tier: "keepsake", upload_cap_notified_at: null, custom_price_cents: 15000 });
  });

  describe("notifyPackageUpdate (tier/price confirmation email)", () => {
    it("doesn't email the host on a tier change when notifyPackageUpdate isn't set -- a plain correction", async () => {
      sb.mockResponse({ data: { id: "b1", tier: "premium", email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ tier: "premium" }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      expect(sendBookingUpdateConfirmation).not.toHaveBeenCalled();
    });

    it("emails the host when notifyPackageUpdate is explicitly set alongside a tier change", async () => {
      sb.mockResponse({ data: { id: "b1", tier: "premium", custom_price_cents: null, email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ tier: "premium", notifyPackageUpdate: true }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      expect(sendBookingUpdateConfirmation).toHaveBeenCalledWith({
        to: "jordan@example.com",
        hostName: "Jordan",
        tier: "premium",
        customPriceCents: null,
      });
    });

    it("also emails on a custom_price_cents-only change with notifyPackageUpdate set", async () => {
      sb.mockResponse({ data: { id: "b1", tier: "standard", custom_price_cents: 5000, email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ custom_price_cents: 5000, notifyPackageUpdate: true }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      expect(sendBookingUpdateConfirmation).toHaveBeenCalledTimes(1);
    });

    it("ignores notifyPackageUpdate when neither tier nor custom_price_cents is in the request", async () => {
      sb.mockResponse({ data: { id: "b1", host_name: "Jordan Updated" }, error: null });
      const res = await PATCH(jsonRequest({ host_name: "Jordan Updated", notifyPackageUpdate: true }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      expect(sendBookingUpdateConfirmation).not.toHaveBeenCalled();
    });

    it("still succeeds even if the package update email fails to send", async () => {
      sendBookingUpdateConfirmation.mockRejectedValue(new Error("resend is down"));
      sb.mockResponse({ data: { id: "b1", tier: "premium", email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ tier: "premium", notifyPackageUpdate: true }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
    });
  });

  describe("host details", () => {
    it("rejects an empty host name", async () => {
      const res = await PATCH(jsonRequest({ host_name: "   " }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
      expect(sb.callLog.length).toBe(0);
    });

    it("trims and accepts a valid host name", async () => {
      sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
      const res = await PATCH(jsonRequest({ host_name: "  Jordan Smith  " }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ host_name: "Jordan Smith" });
    });

    it("rejects an email with no @", async () => {
      const res = await PATCH(jsonRequest({ email: "not-an-email" }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
      expect(sb.callLog.length).toBe(0);
    });

    it("accepts a valid email", async () => {
      sb.mockResponse({ data: { id: "b1", email: "jordan@example.com" }, error: null });
      const res = await PATCH(jsonRequest({ email: "jordan@example.com" }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
    });

    it("rejects an empty event type", async () => {
      const res = await PATCH(jsonRequest({ event_type: "" }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
    });

    it("rejects a negative guest count but accepts null to clear it", async () => {
      const bad = await PATCH(jsonRequest({ guest_count: -5 }), { params: { id: "b1" } });
      expect(bad.status).toBe(400);

      sb.mockResponse({ data: { id: "b1", guest_count: null }, error: null });
      const ok = await PATCH(jsonRequest({ guest_count: null }), { params: { id: "b1" } });
      expect(ok.status).toBe(200);
    });

    it("accepts notes, including clearing them to null", async () => {
      sb.mockResponse({ data: { id: "b1", notes: null }, error: null });
      const res = await PATCH(jsonRequest({ notes: "" }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      const updateCall = sb.callLog[0].calls.find((c) => c.method === "update");
      expect(updateCall.args[0]).toEqual({ notes: null });
    });
  });

  describe("event_date", () => {
    it("rejects a missing or unparseable date", async () => {
      for (const bad of [null, "", "not-a-date"]) {
        const res = await PATCH(jsonRequest({ event_date: bad }), { params: { id: "b1" } });
        expect(res.status).toBe(400);
      }
      expect(sb.callLog.length).toBe(0);
    });

    it("updates the date without emailing the host when notifyReschedule isn't set -- a plain correction", async () => {
      sb.mockResponse({ data: { id: "b1", event_date: "2026-12-25", email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ event_date: "2026-12-25" }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
      expect(sendRescheduleConfirmation).not.toHaveBeenCalled();
    });

    it("emails the host the reschedule confirmation when notifyReschedule is explicitly set", async () => {
      sb.mockResponse({ data: { id: "b1", event_date: "2027-01-15", email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(
        jsonRequest({ event_date: "2027-01-15", notifyReschedule: true, previousEventDate: "2026-12-25" }),
        { params: { id: "b1" } }
      );
      expect(res.status).toBe(200);
      expect(sendRescheduleConfirmation).toHaveBeenCalledWith({
        to: "jordan@example.com",
        hostName: "Jordan",
        oldDate: "2026-12-25",
        newDate: "2027-01-15",
      });
    });

    it("still succeeds even if the reschedule email fails to send", async () => {
      sendRescheduleConfirmation.mockRejectedValue(new Error("resend is down"));
      sb.mockResponse({ data: { id: "b1", event_date: "2027-01-15", email: "jordan@example.com", host_name: "Jordan" }, error: null });
      const res = await PATCH(jsonRequest({ event_date: "2027-01-15", notifyReschedule: true }), { params: { id: "b1" } });
      expect(res.status).toBe(200);
    });
  });

  describe("style / social_style (locked once processing has read them)", () => {
    it("rejects an unrecognized style", async () => {
      sb.mockResponse({ data: { status: "collecting" }, error: null }); // status pre-check
      const res = await PATCH(jsonRequest({ style: "bogus" }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
    });

    it("accepts every real style", async () => {
      for (const style of ["cinematic", "upbeat", "documentary", "retro", "highlight"]) {
        sb.mockResponse({ data: { status: "collecting" }, error: null }); // status pre-check
        sb.mockResponse({ data: { id: "b1", style }, error: null }); // update
        const res = await PATCH(jsonRequest({ style }), { params: { id: "b1" } });
        expect(res.status).toBe(200);
      }
    });

    it('accepts "none" and null for social_style, not just the 5 real styles', async () => {
      sb.mockResponse({ data: { status: "collecting" }, error: null });
      sb.mockResponse({ data: { id: "b1", social_style: "none" }, error: null });
      const noneRes = await PATCH(jsonRequest({ social_style: "none" }), { params: { id: "b1" } });
      expect(noneRes.status).toBe(200);

      sb.mockResponse({ data: { status: "collecting" }, error: null });
      sb.mockResponse({ data: { id: "b1", social_style: null }, error: null });
      const nullRes = await PATCH(jsonRequest({ social_style: null }), { params: { id: "b1" } });
      expect(nullRes.status).toBe(200);
    });

    it.each(["analyzing", "editing", "awaiting_roast_approval", "delivered"])(
      'rejects a style change once the booking is "%s" -- processing has already used it',
      async (status) => {
        sb.mockResponse({ data: { status }, error: null }); // status pre-check
        const res = await PATCH(jsonRequest({ style: "retro" }), { params: { id: "b1" } });
        expect(res.status).toBe(400);
        // Only the pre-check ran -- no update was attempted.
        expect(sb.callLog.filter((c) => c.calls.some((call) => call.method === "update")).length).toBe(0);
      }
    );

    it.each(["booked", "collecting", "pending_confirmation"])(
      'allows a style change while still "%s" -- nothing has read it yet',
      async (status) => {
        sb.mockResponse({ data: { status }, error: null });
        sb.mockResponse({ data: { id: "b1", style: "retro" }, error: null });
        const res = await PATCH(jsonRequest({ style: "retro" }), { params: { id: "b1" } });
        expect(res.status).toBe(200);
      }
    );

    it("checks the booking's real, freshly-fetched status, not one the client could claim", async () => {
      // No status field sent by the client at all -- the route must fetch
      // it itself rather than trusting anything the request body says.
      sb.mockResponse({ data: { status: "delivered" }, error: null });
      const res = await PATCH(jsonRequest({ style: "retro" }), { params: { id: "b1" } });
      expect(res.status).toBe(400);
    });
  });
});
