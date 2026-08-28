import { describe, it, expect } from "vitest";
import { captureError, flushSentry } from "./sentry";

// The test environment never sets SENTRY_DSN, so these exercise the
// "unconfigured" path -- exactly the state local dev and any environment
// without the DSN set will be in. The contract that matters: neither
// function should ever throw or hang, regardless of configuration state.
describe("lib/sentry (unconfigured -- no SENTRY_DSN)", () => {
  it("captureError does not throw", () => {
    expect(() => captureError(new Error("test"))).not.toThrow();
  });

  it("captureError does not throw when given tags/extra context", () => {
    expect(() => captureError(new Error("test"), { tags: { route: "x" }, extra: { bookingId: "b1" } })).not.toThrow();
  });

  it("captureError does not throw when called with no context argument", () => {
    expect(() => captureError(new Error("test"))).not.toThrow();
  });

  it("flushSentry resolves without hanging", async () => {
    await expect(flushSentry()).resolves.toBeUndefined();
  });
});
