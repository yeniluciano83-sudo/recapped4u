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
  sendCustomQuoteEmail: vi.fn(),
}));

import { supabase } from "@/lib/supabase";
import { sendCustomQuoteEmail } from "@/lib/email";
import { POST } from "./route";

function jsonRequest(body) {
  return { json: async () => body };
}

const BASE_BODY = {
  hostName: "Corporate Host",
  email: "host@example.com",
  eventType: "Corporate Event",
  eventDate: "2026-12-25",
  tier: "premium",
  amount: 500,
};

describe("POST /api/admin/custom-quote", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    stripeMocks.sessionsCreate.mockReset();
    sendCustomQuoteEmail.mockReset();
    process.env.APP_URL = "https://test.example";
  });

  it("rejects a missing required field", async () => {
    const res = await POST(jsonRequest({ ...BASE_BODY, hostName: "" }));
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("rejects the free tier, which has nothing to quote", async () => {
    const res = await POST(jsonRequest({ ...BASE_BODY, tier: "free" }));
    expect(res.status).toBe(400);
  });

  it("rejects a zero or non-numeric amount", async () => {
    let res = await POST(jsonRequest({ ...BASE_BODY, amount: 0 }));
    expect(res.status).toBe(400);
    res = await POST(jsonRequest({ ...BASE_BODY, amount: "not-a-number" }));
    expect(res.status).toBe(400);
  });

  it("rejects an end date before the start date", async () => {
    const res = await POST(jsonRequest({ ...BASE_BODY, eventDate: "2026-12-25", eventEndDate: "2026-12-24" }));
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("creates a quote at the custom price and returns the checkout URL", async () => {
    sb.mockResponse({ data: { id: "quote-1" }, error: null }); // insert
    sb.mockResponse({ data: null, error: null }); // update stripe_session_id
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/quote1" });

    const res = await POST(jsonRequest(BASE_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ bookingId: "quote-1", checkoutUrl: "https://checkout.stripe.com/quote1", emailSent: true });

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(50000); // $500.00 in cents

    const insertCall = sb.callLog[0].calls.find((c) => c.method === "insert");
    expect(insertCall.args[0].custom_price_cents).toBe(50000);
    expect(insertCall.args[0].gallery_template).toBe("polaroid");

    // The whole point of this feature -- the host gets a real email with the
    // payment link instead of depending on staff to paste it somewhere.
    expect(sendCustomQuoteEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendCustomQuoteEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe("host@example.com");
    expect(emailArgs.checkoutUrl).toBe("https://checkout.stripe.com/quote1");
    expect(emailArgs.amount).toBe("$500.00");
  });

  it("still returns the checkout link (with emailSent: false) when the confirmation email fails to send", async () => {
    sb.mockResponse({ data: { id: "quote-1" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/quote1" });
    sendCustomQuoteEmail.mockRejectedValue(new Error("resend down"));

    const res = await POST(jsonRequest(BASE_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ bookingId: "quote-1", checkoutUrl: "https://checkout.stripe.com/quote1", emailSent: false });
  });

  // No UI in the dashboard's custom-quote form actually sends social_cuts
  // today, but the route itself accepts it as a real value (a
  // social-cut-eligible tier + deliveryFormat: "social_cuts") -- worth its
  // own regression check even though gallery_template no longer varies by
  // format at all (see defaultGalleryTemplate in lib/pricing.js), so this
  // stays covered if that ever changes back.
  it('defaults gallery_template to polaroid for a "social_cuts" quote too', async () => {
    sb.mockResponse({ data: { id: "quote-sc" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_sc", url: "https://checkout.stripe.com/sc" });

    const res = await POST(jsonRequest({ ...BASE_BODY, deliveryFormat: "social_cuts" }));
    expect(res.status).toBe(200);
    const insertCall = sb.callLog[0].calls.find((c) => c.method === "insert");
    expect(insertCall.args[0].delivery_format).toBe("social_cuts");
    expect(insertCall.args[0].gallery_template).toBe("polaroid");
  });

  it("uses a custom label and description on the checkout line item when provided", async () => {
    sb.mockResponse({ data: { id: "quote-2" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_2", url: "https://checkout.stripe.com/quote2" });

    await POST(jsonRequest({ ...BASE_BODY, label: "2-Day Wedding Coverage", description: "Includes both ceremony and reception" }));

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items[0].price_data.product_data).toEqual({
      name: "2-Day Wedding Coverage",
      description: "Includes both ceremony and reception",
    });
  });

  it("adds a Roast Reel line item only when the tier/level actually charges for it", async () => {
    sb.mockResponse({ data: { id: "quote-3" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_3", url: "https://checkout.stripe.com/quote3" });

    await POST(jsonRequest({ ...BASE_BODY, tier: "premium", roastEnabled: true, roastLevel: "hot" }));

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items).toHaveLength(2);
    expect(sessionArgs.line_items[1].price_data.unit_amount).toBe(2000);
  });

  // Same clamp as app/api/bookings/route.js -- social cuts render
  // caption-free in every delivery format, so a social-cuts-only quote
  // can't be billed for a Lukewarm/Hot upcharge it has no full video left
  // to actually caption.
  it("clamps roast intensity to Light on a social-cuts-only quote, even with Hot selected -- no upcharge", async () => {
    sb.mockResponse({ data: { id: "quote-5" }, error: null });
    sb.mockResponse({ data: null, error: null });
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_5", url: "https://checkout.stripe.com/quote5" });

    await POST(jsonRequest({ ...BASE_BODY, tier: "premium", deliveryFormat: "social_cuts", roastEnabled: true, roastLevel: "hot" }));

    const insertCall = sb.callLog[0].calls.find((c) => c.method === "insert");
    expect(insertCall.args[0].roast_level).toBe("light");

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items).toHaveLength(1); // no Roast Reel line item
  });

  it("retries the insert without event_end_date when migration 023 hasn't run yet (PGRST204)", async () => {
    sb.mockResponse({ data: null, error: { code: "PGRST204" } }); // first insert, with event_end_date, fails
    sb.mockResponse({ data: { id: "quote-4" }, error: null }); // retry insert, without event_end_date, succeeds
    sb.mockResponse({ data: null, error: null }); // update stripe_session_id
    stripeMocks.sessionsCreate.mockResolvedValue({ id: "cs_test_4", url: "https://checkout.stripe.com/quote4" });

    const res = await POST(jsonRequest({ ...BASE_BODY, eventEndDate: "2026-12-26" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.bookingId).toBe("quote-4");

    const firstInsert = sb.callLog[0].calls.find((c) => c.method === "insert");
    expect(firstInsert.args[0].event_end_date).toBe("2026-12-26");
    const retryInsert = sb.callLog[1].calls.find((c) => c.method === "insert");
    expect(retryInsert.args[0].event_end_date).toBeUndefined();
  });

  it("returns 500 and never calls Stripe when the insert fails for a reason other than PGRST204", async () => {
    sb.mockResponse({ data: null, error: new Error("db down") });

    const res = await POST(jsonRequest(BASE_BODY));

    expect(res.status).toBe(500);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
