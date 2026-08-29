import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

// The route's rate limiter is an in-memory Map keyed by IP, module-scoped
// and never reset between tests -- give every test its own IP so they can't
// interfere with each other's attempt counts.
let ipCounter = 0;
function makeRequest(password, ip = `1.2.3.${++ipCounter}`) {
  return {
    json: async () => ({ password }),
    headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) },
  };
}

// The route always awaits a fixed 400ms delay before responding (a brute
// force deterrent) -- advance fake timers past it so tests don't actually wait.
async function runPost(req) {
  const promise = POST(req);
  await vi.advanceTimersByTimeAsync(400);
  return promise;
}

describe("POST /api/dashboard-auth", () => {
  const REAL_PASSWORD = "correct-horse-battery-staple";

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DASHBOARD_PASSWORD = REAL_PASSWORD;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs in with the correct password and sets the auth cookie", async () => {
    const res = await runPost(makeRequest(REAL_PASSWORD));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
    expect(res.cookies.get("dashboard_auth")?.value).toBe(REAL_PASSWORD);
  });

  it("rejects an incorrect password", async () => {
    const res = await runPost(makeRequest("wrong-password"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ success: false });
  });

  it("rejects login when DASHBOARD_PASSWORD isn't configured, even with an empty submitted password", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const res = await runPost(makeRequest(""));
    expect(res.status).toBe(401);
  });

  it("rate-limits after too many failed attempts from the same IP", async () => {
    const ip = "9.9.9.9";
    for (let i = 0; i < 5; i++) {
      await runPost(makeRequest("wrong", ip));
    }
    const res = await runPost(makeRequest("wrong", ip));
    expect(res.status).toBe(429);
  });

  it("does not rate-limit a different IP that hasn't made any attempts yet", async () => {
    const ip = "8.8.8.8";
    for (let i = 0; i < 5; i++) {
      await runPost(makeRequest("wrong", ip));
    }
    const res = await runPost(makeRequest(REAL_PASSWORD, "8.8.8.9"));
    expect(res.status).toBe(200);
  });
});
