import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getSignedDownloadUrl: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";
import { GET } from "./route";

const BOOKING = {
  id: "b1",
  host_name: "Jordan Smith",
  event_type: "Wedding",
  event_date: "2026-12-25",
  status: "delivered",
  tier: "standard",
  style: "cinematic",
  delivery_format: "video",
  gallery_template: "grid",
  gallery_expires_at: null,
};

describe("GET /api/gallery/[bookingId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getSignedDownloadUrl.mockReset();
    getSignedDownloadUrl.mockImplementation(async (key) => `https://signed.example/${key}`);
  });

  it("returns 404 when the booking can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET({}, { params: { bookingId: "b1" } });
    expect(res.status).toBe(404);
  });

  it("returns the booking with an empty gallery when there's no deliverable yet", async () => {
    sb.mockResponse({ data: BOOKING, error: null }); // booking select
    sb.mockResponse({ data: null, error: null }); // deliverable select, none found

    const res = await GET({}, { params: { bookingId: "b1" } });
    const json = await res.json();

    expect(json).toEqual({ booking: BOOKING, deliverable: null, photos: [] });
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("falls back to the singular social_video_key when social_video_keys is absent (pre-migration rows)", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({
      data: {
        full_video_key: "full.mp4",
        social_video_key: "social-old.mp4",
        gallery_photo_keys: [],
      },
      error: null,
    });

    const res = await GET({}, { params: { bookingId: "b1" } });
    const json = await res.json();

    expect(json.deliverable.social_video_urls).toEqual(["https://signed.example/social-old.mp4"]);
  });

  it("returns full deliverable URLs, including posters, for a complete row", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({
      data: {
        full_video_key: "full.mp4",
        full_video_no_roast_key: "full-no-roast.mp4",
        full_video_poster_key: "full-poster.jpg",
        full_video_no_roast_poster_key: "full-no-roast-poster.jpg",
        social_video_keys: ["s1.mp4", "s2.mp4"],
        social_video_no_roast_keys: ["s1-nr.mp4"],
        social_video_poster_keys: ["s1-poster.jpg", "s2-poster.jpg"],
        social_video_no_roast_poster_keys: ["s1-nr-poster.jpg"],
        gallery_photo_keys: ["p1.jpg", "p2.jpg"],
      },
      error: null,
    });

    const res = await GET({}, { params: { bookingId: "b1" } });
    const json = await res.json();

    expect(json.deliverable.full_video_url).toBe("https://signed.example/full.mp4");
    expect(json.deliverable.full_video_poster_url).toBe("https://signed.example/full-poster.jpg");
    expect(json.deliverable.social_video_urls).toEqual([
      "https://signed.example/s1.mp4",
      "https://signed.example/s2.mp4",
    ]);
    expect(json.deliverable.social_video_poster_urls).toEqual([
      "https://signed.example/s1-poster.jpg",
      "https://signed.example/s2-poster.jpg",
    ]);
    expect(json.photos).toEqual(["https://signed.example/p1.jpg", "https://signed.example/p2.jpg"]);
    expect(json.photo_download_urls).toEqual(["https://signed.example/p1.jpg", "https://signed.example/p2.jpg"]);
  });

  it("leaves poster URLs null for a deliverable predating migration 027", async () => {
    sb.mockResponse({ data: BOOKING, error: null });
    sb.mockResponse({
      data: { full_video_key: "full.mp4", gallery_photo_keys: [] },
      error: null,
    });

    const res = await GET({}, { params: { bookingId: "b1" } });
    const json = await res.json();

    expect(json.deliverable.full_video_poster_url).toBeNull();
    expect(json.deliverable.social_video_poster_urls).toEqual([]);
  });
});
