import { describe, it, expect } from "vitest";
import { buildAnalysisRequest, shouldFallBackToSyncAnalysis, parseBatchResults, BATCH_FALLBACK_HOURS, MODEL } from "./batchAnalysis";

describe("buildAnalysisRequest", () => {
  it("uses the upload id as custom_id and base64-encodes the image", () => {
    const buffer = Buffer.from("fake-photo-bytes");
    const req = buildAnalysisRequest("upload-123", buffer, "image/jpeg");

    expect(req.custom_id).toBe("upload-123");
    expect(req.params.model).toBe(MODEL);
    const imageBlock = req.params.messages[0].content.find((b) => b.type === "image");
    expect(imageBlock.source.media_type).toBe("image/jpeg");
    expect(imageBlock.source.data).toBe(buffer.toString("base64"));
  });

  it("includes the analysis text prompt alongside the image", () => {
    const req = buildAnalysisRequest("upload-123", Buffer.from("x"), "image/png");
    const textBlock = req.params.messages[0].content.find((b) => b.type === "text");
    expect(textBlock.text).toMatch(/technical_quality/);
  });
});

describe("shouldFallBackToSyncAnalysis", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("is false when no batch has been submitted yet", () => {
    expect(shouldFallBackToSyncAnalysis(null, now)).toBe(false);
  });

  it(`is false when under the ${BATCH_FALLBACK_HOURS}-hour threshold`, () => {
    const startedAt = new Date(now.getTime() - (BATCH_FALLBACK_HOURS - 1) * 60 * 60 * 1000).toISOString();
    expect(shouldFallBackToSyncAnalysis(startedAt, now)).toBe(false);
  });

  it(`is true once at or past the ${BATCH_FALLBACK_HOURS}-hour threshold`, () => {
    const startedAt = new Date(now.getTime() - BATCH_FALLBACK_HOURS * 60 * 60 * 1000).toISOString();
    expect(shouldFallBackToSyncAnalysis(startedAt, now)).toBe(true);
  });
});

describe("parseBatchResults", () => {
  function succeededLine(customId, analysisObj) {
    return JSON.stringify({
      custom_id: customId,
      result: {
        type: "succeeded",
        message: { content: [{ type: "text", text: JSON.stringify(analysisObj) }] },
      },
    });
  }

  it("maps a succeeded result to its parsed analysis", () => {
    const analysis = { technical_quality: 8, emotional_strength: 7, flagged: false };
    const results = parseBatchResults([succeededLine("upload-1", analysis)]);
    expect(results.get("upload-1")).toEqual({ analysis });
  });

  it("strips a ```json code fence from the response text before parsing", () => {
    const line = JSON.stringify({
      custom_id: "upload-1",
      result: {
        type: "succeeded",
        message: { content: [{ type: "text", text: "```json\n{\"technical_quality\": 5}\n```" }] },
      },
    });
    expect(parseBatchResults([line]).get("upload-1")).toEqual({ analysis: { technical_quality: 5 } });
  });

  it("records an error (not a throw) for malformed JSON in a succeeded result", () => {
    const line = JSON.stringify({
      custom_id: "upload-1",
      result: { type: "succeeded", message: { content: [{ type: "text", text: "not json" }] } },
    });
    const results = parseBatchResults([line]);
    expect(results.get("upload-1").error).toMatch(/Failed to parse analysis JSON/);
    expect(results.get("upload-1").analysis).toBeUndefined();
  });

  it.each(["errored", "expired", "canceled"])("records an error for a %s result", (type) => {
    const line = JSON.stringify({ custom_id: "upload-1", result: { type } });
    const results = parseBatchResults([line]);
    expect(results.get("upload-1").error).toBeTruthy();
    expect(results.get("upload-1").analysis).toBeUndefined();
  });

  it("uses the errored result's own error message when present", () => {
    const line = JSON.stringify({
      custom_id: "upload-1",
      result: { type: "errored", error: { error: { message: "invalid_request_error: bad image" } } },
    });
    expect(parseBatchResults([line]).get("upload-1").error).toBe("invalid_request_error: bad image");
  });

  it("matches results to uploads by custom_id regardless of line order", () => {
    const results = parseBatchResults([
      succeededLine("upload-2", { technical_quality: 2 }),
      succeededLine("upload-1", { technical_quality: 1 }),
    ]);
    expect(results.get("upload-1")).toEqual({ analysis: { technical_quality: 1 } });
    expect(results.get("upload-2")).toEqual({ analysis: { technical_quality: 2 } });
  });

  it("skips falsy lines", () => {
    expect(parseBatchResults([null, "", succeededLine("upload-1", { technical_quality: 9 })]).size).toBe(1);
  });
});
