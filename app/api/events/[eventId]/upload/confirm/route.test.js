import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({
  deleteFile: vi.fn(async () => {}),
  getObjectSize: vi.fn(),
}));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { deleteFile, getObjectSize } from "@/lib/storage";
import { captureError } from "@/lib/sentry";
import { POST } from "./route";

function makeRequest(body) {
  return { headers: { get: () => null }, json: async () => body };
}

const VALID_BODY = { key: "raw/b1/123_photo.jpg", clientUploadId: "photo.jpg_1024_1", uploaderName: "Jordan" };

describe("POST /api/events/[eventId]/upload/confirm -- status guards", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getObjectSize.mockReset();
    deleteFile.mockClear();
    captureError.mockClear();
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(404);
  });

  it("rejects a cancelled event without ever checking the object", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "cancelled" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
    expect(getObjectSize).not.toHaveBeenCalled();
  });

  it("rejects an event that's already processing (editing)", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "editing" }, error: null });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/already started processing/);
  });
});

describe("POST /api/events/[eventId]/upload/confirm -- object verification and insert", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getObjectSize.mockReset();
    deleteFile.mockClear();
    captureError.mockClear();
  });

  it("returns a retryable 500 when the object hasn't landed yet", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "collecting" }, error: null });
    getObjectSize.mockResolvedValue(null);
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
  });

  it('deletes and rejects an object that turns out to be oversized, scoped to "file"', async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "collecting" }, error: null });
    getObjectSize.mockResolvedValue(26 * 1024 * 1024);
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.scope).toBe("file");
    expect(deleteFile).toHaveBeenCalledWith(VALID_BODY.key);
  });

  it("inserts the upload row and marks the booking collecting on success", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "booked" }, error: null }); // booking lookup
    getObjectSize.mockResolvedValue(1024);
    sb.mockResponse({ data: { id: "u1", storage_key: VALID_BODY.key }, error: null }); // insert
    sb.mockResponse({ data: null, error: null }); // status update
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.upload.id).toBe("u1");
    const insertCall = sb.callLog.find((c) => c.table === "uploads" && c.calls.some((call) => call.method === "insert"));
    expect(insertCall.calls.find((call) => call.method === "insert").args[0]).toMatchObject({
      booking_id: "b1",
      uploader_name: "Jordan",
      storage_key: VALID_BODY.key,
      file_type: "photo",
      client_upload_id: VALID_BODY.clientUploadId,
    });
  });

  it("returns the winning row and cleans up this object on a duplicate-race unique violation", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    getObjectSize.mockResolvedValue(1024);
    sb.mockResponse({ data: null, error: { code: "23505", message: "duplicate" } }); // insert loses the race
    sb.mockResponse({ data: { id: "winner-1" }, error: null }); // winner lookup
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.upload.id).toBe("winner-1");
    expect(deleteFile).toHaveBeenCalledWith(VALID_BODY.key);
  });

  // The uploads_enforce_cap trigger (migration 033) raises UPCAP when the
  // event is already at its tier's limit. presign checks the same cap first,
  // so getting here means the count moved underneath us -- the concurrent race
  // the trigger exists to close.
  it("returns a readable 400 and cleans up when the trigger reports the event is full", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    getObjectSize.mockResolvedValue(1024);
    sb.mockResponse({ data: null, error: { code: "UPCAP", message: "upload cap of 20 reached for booking b1" } });
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    const json = await res.json();

    // A full event is not a server fault -- 400, not 500.
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/upload limit/i);
    // scope "file" so the client drops this one photo rather than aborting
    // the guest's whole batch.
    expect(json.scope).toBe("file");
    // The object reached R2 before the insert was rejected; without an uploads
    // row it's invisible to both curation and the 30-day purge job.
    expect(deleteFile).toHaveBeenCalledWith(VALID_BODY.key);
    // Nothing broke, so this shouldn't page anyone.
    expect(captureError).not.toHaveBeenCalled();
  });

  it("captures the error, cleans up, and returns 500 on a genuine insert failure", async () => {
    sb.mockResponse({ data: { id: "b1", uploads_closed_at: null, status: "collecting" }, error: null }); // booking
    getObjectSize.mockResolvedValue(1024);
    sb.mockResponse({ data: null, error: { code: "23503", message: "fk violation" } }); // insert fails, not a duplicate race
    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(500);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(VALID_BODY.key);
  });
});
