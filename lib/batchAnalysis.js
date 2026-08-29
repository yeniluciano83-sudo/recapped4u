"use strict";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 1024;

// Same analysis prompt for both the batched and synchronous (fallback)
// photo-analysis paths in scripts/auto-recap.js -- kept in one place so the
// two can never silently drift apart. Nudity/explicit-content flagging is
// part of every photo's analysis (not a separate pass) to enforce the
// Terms of Service "Acceptable use" clause.
const ANALYSIS_PROMPT = `Analyze this event photo. Also check whether it contains nudity or sexually explicit content that would be inappropriate for a general event recap shared with the host and their guests. Respond ONLY with JSON: {"technical_quality": 1-10, "emotional_strength": 1-10, "moment_type": "string", "notes": "short phrase", "flagged": boolean, "flag_reason": "short phrase or null"}`;

function parseAnalysisJson(raw) {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// Builds one Message Batch request for a single photo. custom_id is the
// upload's own id, so a result can be matched back to its upload without
// relying on batch ordering -- see parseBatchResults below, and the
// Batches API's own "results may not match input order" note.
function buildAnalysisRequest(uploadId, buffer, mediaType) {
  return {
    custom_id: uploadId,
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    },
  };
}

// How long a booking is allowed to sit "analyzing" (waiting on its Claude
// batch) before poll-and-recap.js gives up and falls back to the old
// synchronous per-photo analysis path. Anthropic's batches finish in under
// an hour "most" of the time with no faster guarantee, and the scheduler
// only checks in every 3 hours (see .github/workflows/recap-scheduler.yml)
// -- 6 hours gives a batch two real chances to finish before falling back,
// while leaving Luxe's 24-hour turnaround promise (the tightest of any
// tier) comfortable margin, since the rest of the pipeline (enhancement +
// video assembly) reliably finishes in minutes once analysis is done (see
// STALE_EDITING_HOURS in scripts/poll-and-recap.js).
const BATCH_FALLBACK_HOURS = 6;

function shouldFallBackToSyncAnalysis(processingStartedAt, now = new Date()) {
  if (!processingStartedAt) return false;
  const elapsedHours = (now.getTime() - new Date(processingStartedAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= BATCH_FALLBACK_HOURS;
}

// Turns a Message Batch's streamed .jsonl results (one parsed object per
// line from the Batches API results endpoint) into a Map from custom_id
// (an upload id) to { analysis } on success, or { error } for anything else
// (errored/expired/canceled, or a succeeded result whose text isn't valid
// JSON) -- callers treat those the same way the old synchronous path treats
// an isolated per-photo analysis failure: logged and recorded, without
// failing the whole booking.
function parseBatchResults(resultLines) {
  const byUploadId = new Map();
  for (const line of resultLines) {
    if (!line) continue;
    const parsed = typeof line === "string" ? JSON.parse(line) : line;
    const uploadId = parsed.custom_id;
    const result = parsed.result;
    if (result.type === "succeeded") {
      const text = result.message.content.find((b) => b.type === "text")?.text || "";
      try {
        byUploadId.set(uploadId, { analysis: parseAnalysisJson(text) });
      } catch (err) {
        byUploadId.set(uploadId, { error: `Failed to parse analysis JSON: ${err.message}` });
      }
    } else {
      const reason = result.type === "errored" ? (result.error?.error?.message || "unknown error") : `batch result ${result.type}`;
      byUploadId.set(uploadId, { error: reason });
    }
  }
  return byUploadId;
}

module.exports = {
  MODEL,
  ANALYSIS_PROMPT,
  parseAnalysisJson,
  buildAnalysisRequest,
  BATCH_FALLBACK_HOURS,
  shouldFallBackToSyncAnalysis,
  parseBatchResults,
};
