import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getSignedDownloadUrl: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getSignedDownloadUrl } from "@/lib/storage";
import { GET } from "./route";

function makeRequest() {
  return { url: hostUrl(), headers: { get: () => null } };
}

describe("GET /api/events/[eventId]/uploads", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getSignedDownloadUrl.mockReset();
    getSignedDownloadUrl.mockImplementation(async (key) => `https://signed.example/${key}`);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("returns 500 when loading uploads fails", async () => {
    sb.mockResponse({ data: { id: "b1" }, error: null });
    sb.mockResponse({ data: null, error: new Error("db down") });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });

  it("returns photos with signed URLs and both must-include flags", async () => {
    sb.mockResponse({ data: { id: "b1" }, error: null });
    sb.mockResponse({
      data: [
        { id: "u1", storage_key: "k1", must_include: true, must_include_social: false, uploader_name: "Jordan", uploaded_at: "2026-01-01" },
        { id: "u2", storage_key: "k2", must_include: false, must_include_social: true, uploader_name: "Guest", uploaded_at: "2026-01-02" },
      ],
      error: null,
    });

    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();

    expect(json.photos).toEqual([
      { id: "u1", mustInclude: true, mustIncludeSocial: false, uploaderName: "Jordan", url: "https://signed.example/k1" },
      { id: "u2", mustInclude: false, mustIncludeSocial: true, uploaderName: "Guest", url: "https://signed.example/k2" },
    ]);
  });

  it("returns an empty list when there are no uploads", async () => {
    sb.mockResponse({ data: { id: "b1" }, error: null });
    sb.mockResponse({ data: null, error: null });
    const res = await GET(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json).toEqual({ photos: [] });
  });
});
