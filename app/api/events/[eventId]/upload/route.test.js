import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { POST } from "./route";

// The status guards all fire before req.formData() is ever touched, so a
// request stub that doesn't implement formData() is enough -- if a guard
// wrongly let a request through, it would blow up trying to parse form
// data instead of returning the guard's 400, which is itself a useful
// (if blunt) signal that the guard didn't do its job.
function makeRequest() {
  return { headers: { get: () => null } };
}

describe("POST /api/events/[eventId]/upload -- status guards", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("rejects a cancelled event", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "cancelled" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an event that hasn't been activated yet", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "pending_confirmation" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an event that's already processing (analyzing), even with uploads_closed_at unset", async () => {
    // Its raw photos were already pulled into a Claude batch at submission
    // time -- an upload landing after that would never get analyzed at all.
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "analyzing" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/already started processing/);
  });

  it("rejects an event that's already processing (editing), even with uploads_closed_at unset", async () => {
    // This is the real gap: a booking claimed via its natural deadline (not
    // a manual close-uploads call) never gets uploads_closed_at set at all.
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "editing" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/already started processing/);
  });

  it("rejects an event that's already delivered, even with uploads_closed_at unset", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "delivered" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an event with uploads manually closed early", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: "2026-01-01T00:00:00.000Z", status: "collecting" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(400);
  });

  it("lets a collecting, still-open event past the guards (fails later trying to parse form data, not on a guard)", async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null });
    const res = await POST(makeRequest(), { params: { eventId: "slug-1" } });
    // 500, not 400 -- proves it got past every guard and into the upload
    // logic itself, where the stub request's missing formData() blows up.
    expect(res.status).toBe(500);
  });
});

// Unlike the booking-wide guards above, these two rejections are about one
// specific photo -- scope: "file" is what tells both upload pages' client
// loop to skip just this file and keep uploading the rest of the batch,
// instead of aborting everything after it (the actual bug behind a guest
// batch that stopped after 1 of 20 photos).
describe("POST /api/events/[eventId]/upload -- per-file validation", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  function makeUploadRequest(files) {
    const formData = new FormData();
    formData.set("uploaderName", "Guest");
    for (const f of files) formData.append("files", f);
    return { headers: { get: () => null }, formData: async () => formData };
  }

  it('tags a non-image rejection with scope: "file"', async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null });
    const req = makeUploadRequest([new File(["clip"], "clip.mp4", { type: "video/mp4" })]);
    const res = await POST(req, { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.scope).toBe("file");
  });

  it('tags an oversized-file rejection with scope: "file"', async () => {
    sb.mockResponse({ data: { id: "b1", tier: "standard", uploads_closed_at: null, status: "collecting" }, error: null });
    const bigFile = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" });
    const req = makeUploadRequest([bigFile]);
    const res = await POST(req, { params: { eventId: "slug-1" } });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.scope).toBe("file");
  });
});
