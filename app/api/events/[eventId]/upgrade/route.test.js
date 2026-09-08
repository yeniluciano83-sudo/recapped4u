import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

const stripeMocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { checkout: { sessions: { create: stripeMocks.sessionsCreate } } };
  }),
}));

import { supabase } from "@/lib/supabase";
import { GET } from "./route";

function makeRequest(url = hostUrl()) {
  return { url, headers: { get: () => null } };
}

const COLLECTING_STANDARD = { id: "b1", tier: "standard", status: "collecting", upload_slug: "slug-1", email: "jordan@example.com" };

describe("GET /api/events/[eventId]/upgrade", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    stripeMocks.sessionsCreate.mockReset();
    process.env.APP_URL = "https://test.example";
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a request with no host token", async () => {
    sb.mockResponse({ data: COLLECTING_STANDARD, error: null });
    const res = await GET(makeRequest(guestUrl()), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(403);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("redirects back to the QR page with an error when the event isn't collecting", async () => {
    sb.mockResponse({ data: { ...COLLECTING_STANDARD, status: "editing" }, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(307); // NextResponse.redirect's default
    expect(res.headers.get("location")).toContain("/qr/slug-1");
    expect(res.headers.get("location")).toContain("upgrade_error=");
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("redirects with an error when the tier is already at the top upload cap (Spotlight or Luxe)", async () => {
    for (const tier of ["premium", "keepsake"]) {
      sb.mockResponse({ data: { ...COLLECTING_STANDARD, tier }, error: null });
      const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
      expect(res.headers.get("location")).toContain("upgrade_error=");
      expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
    }
  });

  it("creates a Stripe checkout session for exactly the price difference to the next upload-cap tier", async () => {
    sb.mockResponse({ data: COLLECTING_STANDARD, error: null }); // tier: standard ($35) -> premium ($75), diff $40
    stripeMocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/upgrade-session" });

    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });

    expect(stripeMocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(4000); // $40.00 in cents
    expect(sessionArgs.line_items[0].price_data.product_data.name).toContain("Spotlight");
    expect(sessionArgs.metadata).toEqual({ booking_id: "b1", upgrade_to_tier: "premium" });
    expect(sessionArgs.customer_email).toBe("jordan@example.com");
    expect(sessionArgs.success_url).toContain("upgraded=1");
    expect(sessionArgs.success_url).toContain("/qr/slug-1");
    expect(sessionArgs.cancel_url).toContain("/qr/slug-1");
    expect(sessionArgs.cancel_url).not.toContain("upgraded=1");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/upgrade-session");
  });

  it("recommends Highlight, not Spotlight/Luxe, as the upgrade from Free", async () => {
    sb.mockResponse({ data: { ...COLLECTING_STANDARD, tier: "free" }, error: null }); // free ($0) -> standard ($35)
    stripeMocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/free-to-standard" });

    await GET(makeRequest(), { params: { eventId: "slug-1" } });

    const sessionArgs = stripeMocks.sessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(3500); // $35.00
    expect(sessionArgs.metadata.upgrade_to_tier).toBe("standard");
  });

  it("redirects with an error when Stripe checkout creation fails, instead of a raw 500 a human would see directly", async () => {
    sb.mockResponse({ data: COLLECTING_STANDARD, error: null });
    stripeMocks.sessionsCreate.mockRejectedValue(new Error("stripe is down"));

    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/qr/slug-1");
    expect(res.headers.get("location")).toContain("upgrade_error=");
  });
});
