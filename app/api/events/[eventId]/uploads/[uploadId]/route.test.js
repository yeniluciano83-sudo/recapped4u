import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";
import { hostUrl, guestUrl } from "@/test/helpers/hostToken";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/storage", () => ({ deleteFile: vi.fn(async () => {}) }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { deleteFile } from "@/lib/storage";
import { captureError } from "@/lib/sentry";
import { PATCH, DELETE } from "./route";

function jsonRequest(body) {
  return { json: async () => body, url: hostUrl(), headers: { get: () => null } };
}

function deleteRequest(url = hostUrl()) {
  return { url, headers: { get: () => null } };
}

describe("PATCH /api/events/[eventId]/uploads/[uploadId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(404);
  });

  it("rejects a request with no recognized fields", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard" }, error: null });
    const res = await PATCH(jsonRequest({ somethingElse: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
  });

  it("toggles mustInclude on any tier", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: { must_include: true, must_include_social: false }, error: null });

    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, mustInclude: true, mustIncludeSocial: false });
    const updateCall = sb.callLog[1].calls.find((c) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ must_include: true });
  });

  it("rejects mustIncludeSocial on a tier without social cuts", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard" }, error: null });
    const res = await PATCH(jsonRequest({ mustIncludeSocial: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
    // No uploads table call should have been attempted -- only the booking select.
    expect(sb.callLog.length).toBe(1);
  });

  it("allows mustIncludeSocial on Spotlight and Luxe", async () => {
    for (const tier of ["premium", "keepsake"]) {
      sb.mockResponse({ data: { id: "b1", tier }, error: null });
      sb.mockResponse({ data: { must_include: false, must_include_social: true }, error: null });

      const res = await PATCH(jsonRequest({ mustIncludeSocial: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
      expect(res.status).toBe(200);
    }
  });

  it("rejects mustIncludeSocial on a Spotlight/Luxe booking set to video_only", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "premium", delivery_format: "video_only" }, error: null });
    const res = await PATCH(jsonRequest({ mustIncludeSocial: true }), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
    // No uploads table call should have been attempted -- only the booking select.
    expect(sb.callLog.length).toBe(1);
  });

  it("scopes the update to the upload's own booking, not just its id", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: { must_include: true, must_include_social: false }, error: null });

    await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "u1" } });

    const eqCalls = sb.callLog[1].calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["booking_id", "b1"] });
  });

  it("returns 404 when the upload doesn't belong to this booking", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "free" }, error: null });
    sb.mockResponse({ data: null, error: null }); // maybeSingle finds nothing

    const res = await PATCH(jsonRequest({ mustInclude: true }), { params: { eventId: "slug-1", uploadId: "wrong-upload" } });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/events/[eventId]/uploads/[uploadId]", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
    deleteFile.mockClear();
    captureError.mockClear();
  });

  it("returns 404 when the event can't be found", async () => {
    sb.mockResponse({ data: null, error: new Error("not found") });
    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(404);
  });

  // A guest holds the same slug that's on the QR poster -- deleting another
  // guest's photo is the host's call alone. See lib/hostToken.js.
  it("rejects a request with no host token, without touching the uploads table", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", upload_cap_notified_at: null }, error: null });
    const res = await DELETE(deleteRequest(guestUrl()), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(403);
    expect(sb.callLog.length).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it.each(["analyzing", "editing", "delivered"])("rejects once the booking is %s -- the photo set is already locked in", async (status) => {
    sb.mockResponse({ data: { id: "b1", status, upload_cap_notified_at: null }, error: null });
    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(400);
    expect(sb.callLog.length).toBe(1);
  });

  it("returns 404 when the upload doesn't belong to this booking", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", upload_cap_notified_at: null }, error: null });
    sb.mockResponse({ data: null, error: null }); // delete().select().maybeSingle() finds nothing
    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "wrong-upload" } });
    expect(res.status).toBe(404);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("scopes the delete to the upload's own booking, deletes the R2 object, and returns success", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", upload_cap_notified_at: null }, error: null });
    sb.mockResponse({ data: { storage_key: "raw/b1/123_photo.jpg" }, error: null });

    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "u1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(deleteFile).toHaveBeenCalledWith("raw/b1/123_photo.jpg");
    const eqCalls = sb.callLog[1].calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["booking_id", "b1"] });
    // Never notified, so nothing to reset -- only 2 .from() calls: booking, delete.
    expect(sb.callLog.length).toBe(2);
  });

  // The whole point of the flag: a host who deletes photos to make room and
  // later re-fills the event should be told again, not just once ever.
  it("resets upload_cap_notified_at when a previously-notified booking has a photo deleted", async () => {
    sb.mockResponse({ data: { id: "b1", status: "collecting", upload_cap_notified_at: "2026-01-01T00:00:00.000Z" }, error: null });
    sb.mockResponse({ data: { storage_key: "raw/b1/123_photo.jpg" }, error: null });
    sb.mockResponse({ data: null, error: null }); // the reset update

    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(200);
    const resetCall = sb.callLog.at(-1);
    expect(resetCall.calls.find((c) => c.method === "update").args[0]).toEqual({ upload_cap_notified_at: null });
  });

  it("still deletes the row and returns success even if the R2 cleanup fails", async () => {
    deleteFile.mockRejectedValueOnce(new Error("R2 down"));
    sb.mockResponse({ data: { id: "b1", status: "collecting", upload_cap_notified_at: null }, error: null });
    sb.mockResponse({ data: { storage_key: "raw/b1/123_photo.jpg" }, error: null });

    const res = await DELETE(deleteRequest(), { params: { eventId: "slug-1", uploadId: "u1" } });
    expect(res.status).toBe(200);
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
