import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getFileBuffer: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getFileBuffer } from "@/lib/storage";
import { GET } from "./route";

function makeRequest(url) {
  return { url, headers: { get: () => null } };
}

describe("GET /api/teaser/[bookingId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getFileBuffer.mockReset();
  });

  it("returns 404 when there's no deliverable row at all", async () => {
    sb.mockResponse({ data: null, error: null });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
    expect(getFileBuffer).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking has no teaser (Free/Highlight tier)", async () => {
    sb.mockResponse({ data: { teaser_video_key: null }, error: null });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
    expect(getFileBuffer).not.toHaveBeenCalled();
  });

  it("streams the teaser video when one exists", async () => {
    sb.mockResponse({ data: { teaser_video_key: "deliverable/b1/teaser.mp4" }, error: null });
    getFileBuffer.mockResolvedValue(Buffer.from("fake-mp4-bytes"));

    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(getFileBuffer).toHaveBeenCalledWith("deliverable/b1/teaser.mp4");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe("fake-mp4-bytes");
  });
});
