import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getFileStream: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getFileStream } from "@/lib/storage";
import { GET } from "./route";

function makeRequest() {
  return { headers: { get: () => null } };
}

describe("GET /api/gallery/[bookingId]/download-all", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getFileStream.mockReset();
  });

  it("returns 404 when the booking can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when there's no deliverable yet", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null }); // booking select
    sb.mockResponse({ data: null, error: null }); // deliverable select, none found
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the deliverable has no gallery photos", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: [] }, error: null });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
  });

  it("streams back a zip with the correct headers when photos exist", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg", "raw/b1/photo2.jpg"] }, error: null });
    getFileStream.mockImplementation(async () => Readable.from([Buffer.from("fake-photo-bytes")]));

    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("jordan-smith-photos.zip");
    expect(getFileStream).toHaveBeenCalledWith("raw/b1/photo1.jpg");
    expect(getFileStream).toHaveBeenCalledWith("raw/b1/photo2.jpg");
  });
});
