import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GET } from "./route";

function makeRequest() {
  return { headers: { get: () => null } };
}

describe("GET /api/qrcode/[slug]", () => {
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

  it("returns a PNG for an existing event", async () => {
    sb.mockResponse({ data: { upload_slug: "slug-1", host_name: "Jordan" }, error: null });
    const res = await GET(makeRequest(), { params: { slug: "slug-1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="recapped-qr-slug-1.png"');

    const buf = Buffer.from(await res.arrayBuffer());
    // PNG magic bytes -- confirms this is a real, non-empty image and not
    // just an empty/garbage buffer that happened to get a 200.
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
