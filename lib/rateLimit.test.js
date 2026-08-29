import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// checkRateLimit's behavior (no-op vs real limiting) is decided once, at
// module-import time, based on whether UPSTASH_REDIS_REST_URL/TOKEN are set
// -- so each scenario below needs its own fresh module instance (via
// vi.resetModules() + a dynamic import) with the env vars set beforehand,
// rather than one shared import at the top of the file.

const redisMocks = vi.hoisted(() => ({ RedisCtor: vi.fn() }));
const ratelimitMocks = vi.hoisted(() => ({
  RatelimitCtor: vi.fn(),
  limit: vi.fn(),
  slidingWindow: vi.fn((requests, window) => ({ requests, window })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: redisMocks.RedisCtor.mockImplementation(function (config) {
    this.config = config;
  }),
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    ratelimitMocks.RatelimitCtor.mockImplementation(function (config) {
      this.config = config;
      this.limit = ratelimitMocks.limit;
    }),
    { slidingWindow: ratelimitMocks.slidingWindow }
  ),
}));

function makeRequest(ip) {
  return { headers: { get: (name) => (name === "x-forwarded-for" ? ip : null) } };
}

describe("checkRateLimit", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    redisMocks.RedisCtor.mockClear();
    ratelimitMocks.RatelimitCtor.mockClear();
    ratelimitMocks.limit.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows every request when Upstash isn't configured, without constructing a limiter", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkRateLimit } = await import("./rateLimit");

    const result = await checkRateLimit("test", makeRequest("1.2.3.4"), { requests: 10, windowSeconds: 60 });

    expect(result).toEqual({ success: true });
    expect(redisMocks.RedisCtor).not.toHaveBeenCalled();
    expect(ratelimitMocks.RatelimitCtor).not.toHaveBeenCalled();
  });

  it("allows every request when only one of the two env vars is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkRateLimit } = await import("./rateLimit");

    const result = await checkRateLimit("test", makeRequest("1.2.3.4"), { requests: 10, windowSeconds: 60 });

    expect(result).toEqual({ success: true });
    expect(ratelimitMocks.RatelimitCtor).not.toHaveBeenCalled();
  });

  describe("with Upstash configured", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    });

    it("delegates to the limiter, keyed by the client's IP from x-forwarded-for", async () => {
      const { checkRateLimit } = await import("./rateLimit");
      ratelimitMocks.limit.mockResolvedValue({ success: true, remaining: 9 });

      const result = await checkRateLimit("test-route", makeRequest("5.6.7.8, 9.9.9.9"), { requests: 10, windowSeconds: 60 });

      expect(result).toEqual({ success: true, remaining: 9 });
      expect(ratelimitMocks.limit).toHaveBeenCalledWith("5.6.7.8");
    });

    it("falls back to 'unknown' when there's no x-forwarded-for header", async () => {
      const { checkRateLimit } = await import("./rateLimit");
      ratelimitMocks.limit.mockResolvedValue({ success: true });

      await checkRateLimit("test-route", makeRequest(null), { requests: 10, windowSeconds: 60 });

      expect(ratelimitMocks.limit).toHaveBeenCalledWith("unknown");
    });

    it("propagates a denied result from the limiter", async () => {
      const { checkRateLimit } = await import("./rateLimit");
      ratelimitMocks.limit.mockResolvedValue({ success: false, remaining: 0 });

      const result = await checkRateLimit("test-route", makeRequest("1.1.1.1"), { requests: 10, windowSeconds: 60 });

      expect(result.success).toBe(false);
    });

    it("reuses one Ratelimit instance across calls with the same name/requests/windowSeconds", async () => {
      const { checkRateLimit } = await import("./rateLimit");
      ratelimitMocks.limit.mockResolvedValue({ success: true });

      await checkRateLimit("shared", makeRequest("1.1.1.1"), { requests: 10, windowSeconds: 60 });
      await checkRateLimit("shared", makeRequest("2.2.2.2"), { requests: 10, windowSeconds: 60 });

      expect(ratelimitMocks.RatelimitCtor).toHaveBeenCalledTimes(1);
    });

    it("builds a separate Ratelimit instance for a different name", async () => {
      const { checkRateLimit } = await import("./rateLimit");
      ratelimitMocks.limit.mockResolvedValue({ success: true });

      await checkRateLimit("route-a", makeRequest("1.1.1.1"), { requests: 10, windowSeconds: 60 });
      await checkRateLimit("route-b", makeRequest("1.1.1.1"), { requests: 10, windowSeconds: 60 });

      expect(ratelimitMocks.RatelimitCtor).toHaveBeenCalledTimes(2);
    });
  });
});
