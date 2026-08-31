import { describe, it, expect, vi, beforeEach } from "vitest";

const captureMessageMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry", () => ({ captureMessage: captureMessageMock }));

import { POST } from "./route";

function makeRequest(body) {
  return { headers: { get: () => null }, json: async () => body };
}

describe("POST /api/events/[eventId]/upload-batch-issue", () => {
  beforeEach(() => {
    captureMessageMock.mockReset();
  });

  it("reports the batch outcome to Sentry with the event id and counts", async () => {
    const res = await POST(makeRequest({ uploadedCount: 5, totalCount: 8, failedCount: 3 }), { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [message, context] = captureMessageMock.mock.calls[0];
    expect(message).toMatch(/slug-1/);
    expect(context.tags).toMatchObject({ eventId: "slug-1" });
    expect(context.extra).toMatchObject({ uploadedCount: 5, totalCount: 8, failedCount: 3 });
  });

  it("doesn't throw on a malformed body", async () => {
    const res = await POST({ headers: { get: () => null }, json: async () => { throw new Error("bad json"); } }, { params: { eventId: "slug-1" } });
    expect(res.status).toBe(200);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
  });
});
