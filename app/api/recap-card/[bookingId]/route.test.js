import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getFileBuffer: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getFileBuffer } from "@/lib/storage";
import { GET } from "./route";

function makeRequest(url) {
  return { url, headers: { get: () => null } };
}

function samplePhotoJpeg() {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 40, g: 90, b: 140 } } }).jpeg().toBuffer();
}

describe("GET /api/recap-card/[bookingId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getFileBuffer.mockReset();
    process.env.APP_URL = "https://test.example";
  });

  it("returns 404 when the booking can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
    expect(getFileBuffer).not.toHaveBeenCalled();
  });

  it("returns 404 when there's no deliverable yet (recap not ready)", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan", event_type: "Wedding" }, error: null });
    sb.mockResponse({ data: null, error: null });
    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
    expect(getFileBuffer).not.toHaveBeenCalled();
  });

  it("builds the card from the first gallery photo when one exists", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan", event_type: "Wedding" }, error: null });
    sb.mockResponse({
      data: { gallery_photo_keys: ["deliverable/b1/photo1.jpg", "deliverable/b1/photo2.jpg"], full_video_poster_key: "deliverable/b1/full-cut-poster.jpg", social_video_poster_keys: [] },
      error: null,
    });
    getFileBuffer.mockResolvedValue(await samplePhotoJpeg());

    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    // The first gallery photo, not the video poster -- see the route's own
    // comment on why the poster (a screenshot of the video's own intro
    // title card, already carrying "<host>'s <event type>") isn't used
    // when a real gallery photo is available.
    expect(getFileBuffer).toHaveBeenCalledWith("deliverable/b1/photo1.jpg");
    const buf = Buffer.from(await res.arrayBuffer());
    // JPEG magic bytes (SOI marker) -- confirms this is a real, non-empty
    // image, not just an empty/garbage buffer that happened to get a 200.
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("falls back to the full video's poster when there are no gallery photos", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan", event_type: "Party" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: [], full_video_poster_key: "deliverable/b1/full-cut-poster.jpg", social_video_poster_keys: [] }, error: null });
    getFileBuffer.mockResolvedValue(await samplePhotoJpeg());

    const res = await GET(makeRequest(), { params: { bookingId: "b1" } });

    expect(res.status).toBe(200);
    expect(getFileBuffer).toHaveBeenCalledWith("deliverable/b1/full-cut-poster.jpg");
  });
});
