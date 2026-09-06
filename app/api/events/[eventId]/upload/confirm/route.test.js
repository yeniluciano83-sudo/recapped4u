import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({
  deleteFile: vi.fn(async () => {}),
  getObjectSize: vi.fn(),
}));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendUploadCapReachedEmail: vi.fn(async () => {}) }));

import { supabase } from "@/lib/supabase";
import { deleteFile, getObjectSize } from "@/lib/storage";
import { captureError } from "@/lib/sentry";
import { sendUploadCapReachedEmail } from "@/lib/email";
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
    sendUploadCapReachedEmail.mockClear();
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
    sendUploadCapReachedEmail.mockClear();
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

// getUploadLimit("free") is 20 -- chosen so the fixture booking below (no
// tier set) exercises the DEFAULT_MAX_UPLOADS_PER_EVENT fallback (500)
// unless a test explicitly sets one, keeping each case's cap unambiguous.
describe("POST /api/events/[eventId]/upload/confirm -- upload-cap-reached notification", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    getObjectSize.mockReset();
    getObjectSize.mockResolvedValue(1024);
    deleteFile.mockClear();
    captureError.mockClear();
    sendUploadCapReachedEmail.mockClear();
  });

  const BOOKING = {
    id: "b1", uploads_closed_at: null, status: "collecting", tier: "free",
    email: "jordan@example.com", host_name: "Jordan Smith", event_type: "Wedding",
    upload_slug: "slug-1", upload_cap_notified_at: null,
  };

  it("sends the email and stamps upload_cap_notified_at when this insert brings the count to exactly the cap", async () => {
    sb.mockResponse({ data: { ...BOOKING }, error: null }); // booking lookup
    sb.mockResponse({ data: { id: "u1", storage_key: VALID_BODY.key }, error: null }); // insert
    sb.mockResponse({ data: null, error: null }); // status update
    sb.mockResponse({ data: null, error: null, count: 20 }); // re-count -- free's cap
    sb.mockResponse({ data: null, error: null }); // upload_cap_notified_at stamp

    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(sendUploadCapReachedEmail).toHaveBeenCalledTimes(1);
    expect(sendUploadCapReachedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "jordan@example.com", tier: "free", uploadSlug: "slug-1", bookingId: "b1" })
    );
    const stampCall = sb.callLog.at(-1);
    expect(stampCall.calls.some((c) => c.method === "update" && "upload_cap_notified_at" in c.args[0])).toBe(true);
  });

  it("does not send when the count is still under the cap", async () => {
    sb.mockResponse({ data: { ...BOOKING }, error: null });
    sb.mockResponse({ data: { id: "u1", storage_key: VALID_BODY.key }, error: null });
    sb.mockResponse({ data: null, error: null });
    sb.mockResponse({ data: null, error: null, count: 19 }); // one short of free's cap (20)

    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(sendUploadCapReachedEmail).not.toHaveBeenCalled();
  });

  // The trigger's row lock (migration 033) means only the one insert that
  // actually crosses the threshold ever sees count === cap -- this flag is
  // the defensive backstop against re-sending regardless, and it's also
  // what makes the "already sent" case cheap: the route skips the re-count
  // query entirely rather than running it just to throw the answer away.
  it("does not re-send (or even re-count) once already notified", async () => {
    sb.mockResponse({ data: { ...BOOKING, upload_cap_notified_at: "2026-01-01T00:00:00.000Z" }, error: null });
    sb.mockResponse({ data: { id: "u1", storage_key: VALID_BODY.key }, error: null });
    sb.mockResponse({ data: null, error: null });

    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(sendUploadCapReachedEmail).not.toHaveBeenCalled();
    // Exactly 3 .from() calls: booking, insert, status update -- no 4th for
    // a re-count that was never going to matter.
    expect(sb.callLog.length).toBe(3);
  });

  it("still returns success to the guest even if the notification email throws", async () => {
    sendUploadCapReachedEmail.mockRejectedValueOnce(new Error("Resend down"));
    sb.mockResponse({ data: { ...BOOKING }, error: null });
    sb.mockResponse({ data: { id: "u1", storage_key: VALID_BODY.key }, error: null });
    sb.mockResponse({ data: null, error: null });
    sb.mockResponse({ data: null, error: null, count: 20 });
    sb.mockResponse({ data: null, error: null });

    const res = await POST(makeRequest(VALID_BODY), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
