import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GET } from "./route";

function makeRequest(url) {
  return { url, headers: { get: () => null } };
}

describe("GET /api/invite/[slug]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    process.env.APP_URL = "https://test.example";
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { slug: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("returns a themed invite JPEG for an existing event", async () => {
    sb.mockResponse({
      data: { upload_slug: "slug-1", host_name: "Jordan", event_type: "Wedding", event_date: "2026-06-14", event_time: "17:30", venue: "The Grand Hall" },
      error: null,
    });
    const res = await GET(makeRequest(), { params: { slug: "slug-1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="recapped-invite-slug-1.jpg"');

    const buf = Buffer.from(await res.arrayBuffer());
    // JPEG magic bytes (SOI marker) -- confirms this is a real, non-empty
    // image, not just an empty/garbage buffer that happened to get a 200.
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("still renders when venue/time were never captured (both nullable)", async () => {
    sb.mockResponse({
      data: { upload_slug: "slug-2", host_name: "Sam", event_type: "Corporate Event", event_date: "2026-03-03", event_time: null, venue: null },
      error: null,
    });
    const res = await GET(makeRequest(), { params: { slug: "slug-2" } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("still renders with ?rsvp=0, the printed-poster variant with no RSVP row", async () => {
    sb.mockResponse({
      data: { upload_slug: "slug-3", host_name: "Jordan", event_type: "Wedding", event_date: "2026-06-14", event_time: "17:30", venue: "The Grand Hall" },
      error: null,
    });
    const res = await GET(makeRequest("https://test.example/api/invite/slug-3?rsvp=0"), { params: { slug: "slug-3" } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});
