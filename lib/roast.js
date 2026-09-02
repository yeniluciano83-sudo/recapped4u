/**
 * Recapped For You — Roast Reel script generator
 * ------------------------------------------------
 * Given the shortlisted photos for a booking with the Roast Reel add-on
 * enabled, generates one witty commentary line per photo -- chunked into
 * batches of ROAST_CHUNK_SIZE photos per Claude call (see the comment
 * there for why) rather than one giant call, but still using one call per
 * chunk instead of one per photo, and each chunk still sees its own whole
 * set so the model can vary its jokes within it.
 *
 * There's no host-approval step before this gets rendered into the video --
 * the SAFETY_RULE below is the only guardrail, enforced at generation time
 * rather than via human review. (An earlier design considered a review step
 * -- see the now-unused `roast_scripts` table and `awaiting_roast_approval`
 * booking status in schema.sql -- but it was never built; this prompt-level
 * rule is the current, intentional approach.)
 */

const sharp = require("sharp");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";

// Claude's API caps individual image dimensions lower once a request bundles
// many images together ("max allowed size for many-image requests: 2000
// pixels") -- confirmed live once shortlists grew past the old 15-photo cap.
// The delivery-quality photos this module receives are resized up to 3840px
// for the video (lib/photo-enhance.js), well over that limit. 1568px is
// Anthropic's own documented sweet spot for vision quality/cost regardless
// of the many-image cap, so resizing down to it here satisfies both.
const MAX_ROAST_IMAGE_DIMENSION = 1568;

// Anthropic's Messages API caps a single request at 32MB (the Batch API
// allows 256MB, but this needs its result immediately within the same
// pipeline run, not a batch's async turnaround -- see lib/batchAnalysis.js
// for where that tradeoff goes the other way). Even after capping each
// photo to MAX_ROAST_IMAGE_DIMENSION above, a large enough shortlist's
// combined base64 payload can still exceed that -- confirmed live: an
// 80-photo Luxe booking with Roast Reel enabled hit a real 413
// "request_too_large" error sending all 80 in one call. Only Free has a
// shortlist cap (SHORTLIST_CAP in scripts/auto-recap.js) -- every paid
// tier is unbounded, so this isn't a one-off, it's guaranteed to recur for
// any sufficiently large paid booking. Chunking keeps every individual
// request safely under the limit regardless of how large a shortlist
// grows, while still producing exactly one line per photo.
const ROAST_CHUNK_SIZE = 20;

const LEVEL_GUIDANCE = {
  light: "Playful, gentle teasing -- an affectionate best friend narrating, not a greeting card. Warm and safe for any audience, but still a real joke with a specific angle, not just a nice compliment wearing a smile.",
  lukewarm: "Sharper, inside-joke energy -- the kind of line only someone who actually knows this group would make. Cheeky, a little bolder, willing to call out the obviously staged pose or the one guest clearly done with the camera, still affectionate underneath.",
  hot: "Full send -- bold, cutting, close-friends-only humor, the kind that gets an actual laugh-out-loud, not a polite smile. Commit to the bit fully. Still never crosses the rule below.",
};

const SAFETY_RULE =
  "Hard rule, regardless of intensity: roast the MOMENT or SITUATION captured in the photo, " +
  "never a person's body, weight, appearance, race, or anything about who they are. If a photo " +
  "doesn't offer an obvious situational angle, make a lighthearted observation about the vibe/energy " +
  "of the scene instead of reaching for a personal jab.";

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

// Caps how many recent lines get spent on prompt tokens -- recentLines can
// carry an arbitrarily large history (the caller controls how far back it
// queries), but the prompt only needs a representative sample to steer the
// model away from repeat angles, not the whole log.
const MAX_RECENT_LINES_IN_PROMPT = 40;

/**
 * @param {Array<{ buffer: Buffer, storageKey: string }>} photos - shortlisted photos, in final video order
 * @param {{ eventType: string, roastLevel: "light" | "lukewarm" | "hot", recentLines?: string[] }} context
 *   recentLines - lines generated for other bookings (or earlier cuts of
 *   this same booking) recently, oldest-to-newest doesn't matter -- passed
 *   in by the caller (scripts/auto-recap.js) since that's what has the
 *   database connection this module deliberately doesn't.
 * @returns {Promise<Array<{ photo_index: number, line: string }>>}
 */
async function generateRoastScript(photos, { eventType, roastLevel, recentLines }) {
  if (!photos || photos.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < photos.length; i += ROAST_CHUNK_SIZE) {
    chunks.push(photos.slice(i, i + ROAST_CHUNK_SIZE));
  }

  // Lines from earlier chunks of THIS same call are folded into the next
  // chunk's own recentLines context (ahead of the caller's original
  // history), so a later chunk still avoids repeating an earlier chunk's
  // joke angles even though each chunk is its own separate Claude call --
  // the whole point of "the model can see the whole set" from a single
  // giant call, preserved across chunk boundaries instead.
  const linesSoFar = [];
  const globalScript = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunkPhotos = chunks[c];
    const chunkOffset = c * ROAST_CHUNK_SIZE;
    const chunkScript = await generateRoastScriptChunk(chunkPhotos, {
      eventType,
      roastLevel,
      recentLines: [...linesSoFar, ...(recentLines || [])],
    });
    for (const entry of chunkScript) {
      globalScript.push({ photo_index: entry.photo_index + chunkOffset, line: entry.line });
      linesSoFar.push(entry.line);
    }
  }

  return validateAndSortRoastScript(globalScript, photos.length);
}

// One Claude call for a single chunk (at most ROAST_CHUNK_SIZE photos) --
// everything generateRoastScript itself used to do directly before
// chunking was added. photo_index in the response (and the one
// validateAndSortRoastScript checks here) is chunk-local (0..chunk.length-1);
// generateRoastScript remaps it to the photo's real position across the
// whole shortlist after this returns.
async function generateRoastScriptChunk(photos, { eventType, roastLevel, recentLines }) {
  const level = LEVEL_GUIDANCE[roastLevel] || LEVEL_GUIDANCE.light;

  const resizedPhotos = await Promise.all(
    photos.map((p) =>
      sharp(p.buffer)
        .resize({ width: MAX_ROAST_IMAGE_DIMENSION, height: MAX_ROAST_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer()
    )
  );

  const imageBlocks = photos
    .map((p, i) => [
      { type: "text", text: `Photo ${i}:` },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: resizedPhotos[i].toString("base64") },
      },
    ])
    .flat();

  const recentLinesSample = (recentLines || []).slice(0, MAX_RECENT_LINES_IN_PROMPT);
  const recentLinesBlock = recentLinesSample.length
    ? `\n\nLines already used recently, for other events or earlier cuts of this same one -- don't reuse these, and steer away from the same joke setups/angles even for a different photo:\n${recentLinesSample.map((l) => `- ${l}`).join("\n")}\n`
    : "";

  const prompt = `You're writing the "Roast Reel" commentary track for a ${eventType} recap video -- short, witty lines that play over each photo, roasting the moment in a way the host and their guests will actually laugh out loud at, not just smile at.

Intensity level: ${roastLevel}. ${level}

Write like a comedy writer, not a caption generator: pick ONE specific, concrete detail in each photo -- a facial expression, body language, something happening in the background, bad timing, an obviously posed shot -- and build the joke around that. Never a generic "what a moment!" line dressed up with an exclamation point. Exaggeration, deadpan understatement, and unexpected comparisons all work well. If a line could apply to literally any photo at any event, rewrite it until it couldn't.

${SAFETY_RULE}

You'll see ${photos.length} photos below, labeled Photo 0 through Photo ${photos.length - 1}, in the order they'll appear in the video. Write ONE line per photo (one or two sentences, punchy, spoken-aloud length -- this gets read as an overlay/voiceover, not a paragraph). Vary your joke structures and angles across the set -- don't reuse the same setup twice.
${recentLinesBlock}
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
  return validateAndSortRoastScript(script, photos.length);
}

// Callers index the result positionally (roastLines[i] <-> photos[i]) --
// photo_index exists specifically so a response whose entries arrive out
// of order (the model isn't guaranteed to preserve input order) still
// lands each line on the right photo instead of silently mismatching
// captions once sorted back into position. Validated as a strict
// permutation of 0..N-1 -- a duplicate or missing index means the
// response can't be trusted to reorder correctly, and continuing anyway
// risks silently dropping or duplicating a line, so it throws instead.
// Split out from generateRoastScript so this validation/sort logic can be
// unit tested without needing to mock the Claude API call or sharp.
function validateAndSortRoastScript(script, expectedCount) {
  if (!Array.isArray(script) || script.length !== expectedCount) {
    throw new Error(
      `Roast script mismatch: expected ${expectedCount} lines, got ${Array.isArray(script) ? script.length : "a non-array response"}`
    );
  }

  const seen = new Set();
  for (const entry of script) {
    if (typeof entry.photo_index !== "number" || entry.photo_index < 0 || entry.photo_index >= expectedCount || seen.has(entry.photo_index)) {
      throw new Error(`Roast script has an invalid or duplicate photo_index: ${JSON.stringify(entry)}`);
    }
    seen.add(entry.photo_index);
  }
  return [...script].sort((a, b) => a.photo_index - b.photo_index);
}

module.exports = { generateRoastScript, validateAndSortRoastScript };
