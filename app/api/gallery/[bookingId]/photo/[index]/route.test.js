import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ getFileStream: vi.fn(), getFileBuffer: vi.fn() }));
vi.mock("@/lib/photo-frame", () => ({ applyPolaroidFrame: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { getFileStream, getFileBuffer } from "@/lib/storage";
import { applyPolaroidFrame } from "@/lib/photo-frame";
import { checkRateLimit } from "@/lib/rateLimit";
import { GET } from "./route";

function makeRequest(url = "https://test.example/api/gallery/b1/photo/0") {
  return { url, headers: { get: () => null } };
}

describe("GET /api/gallery/[bookingId]/photo/[index]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getFileStream.mockReset();
    getFileBuffer.mockReset();
    applyPolaroidFrame.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ success: true });
  });

  it("returns 400 for a non-numeric or negative index", async () => {
    let res = await GET(makeRequest(), { params: { bookingId: "b1", index: "not-a-number" } });
    expect(res.status).toBe(400);
    res = await GET(makeRequest(), { params: { bookingId: "b1", index: "-1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(0);
  });

  it("returns 429 and never queries the database when rate-limited", async () => {
    checkRateLimit.mockResolvedValue({ success: false });
    const res = await GET(makeRequest(), { params: { bookingId: "b1", index: "0" } });
    expect(res.status).toBe(429);
    expect(sb.callLog.length).toBe(0);
  });

  it("returns 404 when the booking can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await GET(makeRequest(), { params: { bookingId: "b1", index: "0" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the index is out of range for this gallery", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    const res = await GET(makeRequest("https://test.example/api/gallery/b1/photo/5"), { params: { bookingId: "b1", index: "5" } });
    expect(res.status).toBe(404);
  });

  it("streams back the plain photo untouched by default", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    getFileStream.mockResolvedValue(Readable.from([Buffer.from("fake-photo-bytes")]));

    const res = await GET(makeRequest(), { params: { bookingId: "b1", index: "0" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jordan-smith-photo-1.jpg"');
    expect(getFileStream).toHaveBeenCalledWith("raw/b1/photo1.jpg");
    expect(getFileBuffer).not.toHaveBeenCalled();
  });

  it("frames the photo and names it \"-polaroid\" when ?style=polaroid is set", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan Smith" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    getFileBuffer.mockResolvedValue(Buffer.from("raw-bytes"));
    applyPolaroidFrame.mockResolvedValue(Buffer.from("framed-bytes"));

    const res = await GET(makeRequest("https://test.example/api/gallery/b1/photo/0?style=polaroid"), { params: { bookingId: "b1", index: "0" } });
    const body = Buffer.from(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jordan-smith-photo-1-polaroid.jpg"');
    expect(getFileBuffer).toHaveBeenCalledWith("raw/b1/photo1.jpg");
    expect(applyPolaroidFrame).toHaveBeenCalledWith(Buffer.from("raw-bytes"));
    expect(body).toEqual(Buffer.from("framed-bytes"));
    expect(getFileStream).not.toHaveBeenCalled();
  });

  it("returns 500 when fetching the photo fails", async () => {
    sb.mockResponse({ data: { id: "b1", host_name: "Jordan" }, error: null });
    sb.mockResponse({ data: { gallery_photo_keys: ["raw/b1/photo1.jpg"] }, error: null });
    getFileStream.mockRejectedValue(new Error("R2 down"));

    const res = await GET(makeRequest(), { params: { bookingId: "b1", index: "0" } });
    expect(res.status).toBe(500);
  });
});
