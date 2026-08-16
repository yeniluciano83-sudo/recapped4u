/**
 * Recapped For You — Roast Reel script generator
 * ------------------------------------------------
 * Given the shortlisted photos for a booking with the Roast Reel add-on
 * enabled, generates one witty commentary line per photo in a single
 * batched Claude call -- so the model can see the whole set and vary its
 * jokes instead of repeating patterns, and so this costs one API call
 * instead of one per photo.
 *
 * This module only produces the draft script. Per the product's own
 * promise to hosts ("you approve the full script before it's shared with
 * guests"), it is NOT rendered into the video automatically -- that
 * requires a separate host-approval step before video assembly runs.
 */

const path = require("path");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const LEVEL_GUIDANCE = {
  light: "Playful, gentle teasing. Warm and safe for any audience -- friendly ribbing, not edgy.",
  lukewarm: "Sharper, inside-joke energy. Cheeky and a little bolder, still affectionate underneath.",
  hot: "Full send -- bold, cutting, close-friends-only humor. Still never crosses the rule below.",
};

const SAFETY_RULE =
  "Hard rule, regardless of intensity: roast the MOMENT or SITUATION captured in the photo, " +
  "never a person's body, weight, appearance, race, or anything about who they are. If a photo " +
  "doesn't offer an obvious situational angle, make a lighthearted observation about the vibe/energy " +
  "of the scene instead of reaching for a personal jab.";

function mediaTypeFor(storageKey) {
  const ext = path.extname(storageKey).toLowerCase();
  return ext === ".png" ? "image/png" : "image/jpeg";
}

async function callClaude(messages, maxTokens) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function parseJsonSafely(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse roast script JSON:", cleaned.slice(0, 300));
    throw err;
  }
}

/**
 * @param {Array<{ buffer: Buffer, storageKey: string }>} photos - shortlisted photos, in final video order
 * @param {{ eventType: string, roastLevel: "light" | "lukewarm" | "hot" }} context
 * @returns {Promise<Array<{ photo_index: number, line: string }>>}
 */
async function generateRoastScript(photos, { eventType, roastLevel }) {
  if (!photos || photos.length === 0) return [];

  const level = LEVEL_GUIDANCE[roastLevel] || LEVEL_GUIDANCE.light;

  const imageBlocks = photos
    .map((p, i) => [
      { type: "text", text: `Photo ${i}:` },
      {
        type: "image",
        source: { type: "base64", media_type: mediaTypeFor(p.storageKey), data: p.buffer.toString("base64") },
      },
    ])
    .flat();

  const prompt = `You're writing the "Roast Reel" commentary track for a ${eventType} recap video -- short, witty lines that play over each photo, roasting the moment in a way the host and their guests will actually laugh at.

Intensity level: ${roastLevel}. ${level}

${SAFETY_RULE}

You'll see ${photos.length} photos below, labeled Photo 0 through Photo ${photos.length - 1}, in the order they'll appear in the video. Write ONE line per photo (one or two sentences, punchy, spoken-aloud length -- this gets read as an overlay/voiceover, not a paragraph). Vary your joke structures and angles across the set -- don't reuse the same setup twice.

Respond ONLY with a JSON array (no preamble, no markdown fences), one entry per photo, in order:
[
  { "photo_index": 0, "line": "..." },
  { "photo_index": 1, "line": "..." }
]`;

  const raw = await callClaude(
    [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
    Math.min(4096, 200 * photos.length + 500)
  );

  const script = parseJsonSafely(raw);
  if (!Array.isArray(script) || script.length !== photos.length) {
    throw new Error(
      `Roast script mismatch: expected ${photos.length} lines, got ${Array.isArray(script) ? script.length : "a non-array response"}`
    );
  }
  return script;
}

module.exports = { generateRoastScript };
