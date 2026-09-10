import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getFileStream: vi.fn(), getFileBuffer: vi.fn() }));
vi.mock("@/lib/photo-frame", () => ({ applyPolaroidFrame: vi.fn() }));
vi.mock("@/lib/photo-collage", () => ({
  buildGridSheet: vi.fn(),
  buildMasonrySheet: vi.fn(),
  GRID_PHOTOS_PER_SHEET: 12,
  MASONRY_PHOTOS_PER_SHEET: 15,
}));

import { supabase } from "@/lib/supabase";
import { getFileStream, getFileBuffer } from "@/lib/storage";
import { applyPolaroidFrame } from "@/lib/photo-frame";
import { buildGridSheet, buildMasonrySheet } from "@/lib/photo-collage";
import { GET } from "./route";

function makeRequest(url = "https://test.example/api/gallery/b1/download-all") {
  return { url, headers: { get: () => null } };
}

// The route kicks off zip-building as a detached (not awaited) async IIFE,
// so GET itself returns before that work necessarily finishes. The plain/
// polaroid paths' single-level loop happens to fully settle within the
// microtask ticks GET's own remaining awaits already consume by the time a
// test's `await GET(...)` resolves -- but grid/masonry chunk into batches,
// each with its own inner loop of sequential getFileBuffer awaits before a
// sheet ever builds, which is more microtask hops than that. A real
// macrotask boundary (setImmediate) is what actually guarantees the
// microtask queue -- however deep -- has fully drained first.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("GET /api/gallery/[bookingId]/download-all", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getFileStream.mockReset();
    getFileBuffer.mockReset();
    applyPolaroidFrame.mockReset();
    buildGridSheet.mockReset();
    buildMasonrySheet.mockReset();
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

  it('frames every photo and names the zip "-polaroid" when ?style=polaroid is set', async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    getFileBuffer.mockResolvedValue(Buffer.from("raw-bytes"));
    applyPolaroidFrame.mockResolvedValue(Buffer.from("framed-bytes"));

    const res = await GET(makeRequest("https://test.example/api/gallery/b1/download-all?style=polaroid"), { params: { bookingId: "b1" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("jordan-smith-photos-polaroid.zip");
    expect(getFileBuffer).toHaveBeenCalledWith("raw/b1/photo1.jpg");
    expect(applyPolaroidFrame).toHaveBeenCalledWith(Buffer.from("raw-bytes"));
    expect(getFileStream).not.toHaveBeenCalled();
  });

  it('builds one grid sheet per batch of 12 photos and names them accordingly', async () => {
    const keys = Array.from({ length: 14 }, (_, i) => `raw/b1/photo${i + 1}.jpg`);
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: keys }, error: null });
    getFileBuffer.mockResolvedValue(Buffer.from("raw-bytes"));
    buildGridSheet.mockResolvedValue(Buffer.from("sheet-bytes"));

    const res = await GET(makeRequest("https://test.example/api/gallery/b1/download-all?style=grid"), { params: { bookingId: "b1" } });
    await flushMicrotasks();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("jordan-smith-photos-grid.zip");
    // 14 photos at 12 per sheet -> 2 sheets, the second with only the 2
    // leftover photos.
    expect(buildGridSheet).toHaveBeenCalledTimes(2);
    expect(buildGridSheet.mock.calls[0][0]).toHaveLength(12);
    expect(buildGridSheet.mock.calls[1][0]).toHaveLength(2);
    expect(buildMasonrySheet).not.toHaveBeenCalled();
  });

  it('builds masonry sheets in batches of 15 and never calls the per-photo paths', async () => {
    const keys = Array.from({ length: 5 }, (_, i) => `raw/b1/photo${i + 1}.jpg`);
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: keys }, error: null });
    getFileBuffer.mockResolvedValue(Buffer.from("raw-bytes"));
    buildMasonrySheet.mockResolvedValue(Buffer.from("sheet-bytes"));

    const res = await GET(makeRequest("https://test.example/api/gallery/b1/download-all?style=masonry"), { params: { bookingId: "b1" } });
    await flushMicrotasks();

    expect(res.headers.get("Content-Disposition")).toContain("jordan-photos-masonry.zip");
    expect(buildMasonrySheet).toHaveBeenCalledTimes(1);
    expect(buildMasonrySheet.mock.calls[0][0]).toHaveLength(5);
    expect(applyPolaroidFrame).not.toHaveBeenCalled();
    expect(getFileStream).not.toHaveBeenCalled();
  });

  it("falls back to plain for any style value outside the recognized set", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    getFileStream.mockResolvedValue(Readable.from([Buffer.from("fake-photo-bytes")]));

    const res = await GET(makeRequest("https://test.example/api/gallery/b1/download-all?style=vintage"), { params: { bookingId: "b1" } });

    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jordan-photos.zip"');
    expect(applyPolaroidFrame).not.toHaveBeenCalled();
    expect(buildGridSheet).not.toHaveBeenCalled();
    expect(buildMasonrySheet).not.toHaveBeenCalled();
  });
});
