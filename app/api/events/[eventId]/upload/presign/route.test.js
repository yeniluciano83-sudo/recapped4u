import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({
  buildStorageKey: vi.fn(({ bookingId, kind, filename }) => `${kind}/${bookingId}/123_${filename}`),
  getSignedUploadUrl: vi.fn(async (key) => `https://signed.example/${key}`),
}));

import { supabase } from "@/lib/supabase";
import { buildStorageKey, getSignedUploadUrl } from "@/lib/storage";
import { POST } from "./route";

function makeRequest(body) {
  return { headers: { get: () => null }, json: async () => body };
}

const VALID_BODY = { filename: "photo.jpg", contentType: "image/jpeg", fileSize: 1024, clientUploadId: "photo.jpg_1024_1" };

describe("POST /api/events/[eventId]/upload/presign -- status guards", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects a cancelled event", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "cancelled" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an event that hasn't been activated yet", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "pending_confirmation" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an event that's already processing (analyzing)", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "analyzing" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/already started processing/);
  });

  it("rejects an event with uploads manually closed early", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: "2026-01-01T00:00:00.000Z", status: "collecting" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/[eventId]/upload/presign -- validation and issuance", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    buildStorageKey.mockClear();
    getSignedUploadUrl.mockClear();
  });

  it('rejects a non-image content type with scope: "file"', async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null });
    const res = await POST(makeRequest({ ...VALID_BODY, contentType: "video/mp4" }), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.scope).toBe("file");
  });

  it('rejects a declared size over the ceiling with scope: "file"', async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null });
    const res = await POST(makeRequest({ ...VALID_BODY, fileSize: 26 * 1024 * 1024 }), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.scope).toBe("file");
  });

  it("returns alreadyUploaded without issuing a URL when the client_upload_id already exists", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    sb.mockResponse({ data: { id: "u1" }, error: null }); // existing client_upload_id lookup
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(json.alreadyUploaded).toBe(true);
    expect(getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects when the upload count is already at the tier's limit", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    sb.mockResponse({ data: null, error: null }); // no existing client_upload_id
    sb.mockResponse({ data: null, error: null, count: 20 }); // existingCount at free tier's cap (20)
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("issues a presigned URL and storage key for a valid request", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    sb.mockResponse({ data: null, error: null }); // no existing client_upload_id
    sb.mockResponse({ data: null, error: null, count: 3 }); // well under the limit
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.uploadUrl).toBe(`https://signed.example/raw/b1/123_photo.jpg`);
    expect(json.key).toBe("raw/b1/123_photo.jpg");
    expect(buildStorageKey).toHaveBeenCalledWith({ bookingId: "b1", kind: "raw", filename: "photo.jpg" });
  });
});
