import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";

describe("GET /api/build-version", () => {
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA;

  afterEach(() => {
    if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = originalSha;
  });

  it("returns the deployment's commit SHA when set", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    const res = await GET();
    const json = await res.json();
    expect(json.sha).toBe("abc123");
  });

  it("falls back to \"dev\" when running outside Vercel", async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const res = await GET();
    const json = await res.json();
    expect(json.sha).toBe("dev");
  });
});
