/**
 * Recapped For You — AI Curation Pipeline
 * ----------------------------------------
 * Takes a folder of raw guest-uploaded photos for one event, sends each
 * image to Claude for analysis, and produces:
 *   1. A per-photo score + tags (quality, moment type, people/emotion)
 *   2. A deduplicated "best shots" shortlist
 *   3. A suggested story-arc ordering for the editor to build the video around
 *   4. Draft caption/title-card text
 *
 * This is the piece that runs AFTER guests upload (via the event upload page)
 * and BEFORE the human editor does their polish pass in CapCut/Premiere.
 *
 * Requirements: Node 18+, an ANTHROPIC_API_KEY environment variable.
 * Run: node curate.js ./events/maya-30th/raw ./events/maya-30th/report.json
 */

const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const SUPPORTED_EXT = [".jpg", ".jpeg", ".png", ".webp"];

// ---------- Helpers ----------

function loadImageAsBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mediaType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { data: buffer.toString("base64"), mediaType };
}

async function callClaude(messages, maxTokens = 1024) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function parseJsonSafely(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse model JSON output:", cleaned.slice(0, 300));
    throw err;
  }
}

// ---------- Stage 1: Per-photo analysis ----------

async function analyzePhoto(filePath) {
  const { data, mediaType } = loadImageAsBase64(filePath);

  const prompt = `You are helping curate photos for an event recap video. Analyze this photo and respond ONLY with a JSON object (no preamble, no markdown fences) with this exact shape:

{
  "technical_quality": 1-10,
  "moment_type": "arrival | candid | group | speech_toast | activity | closeup_emotion | scenery | other",
  "emotional_strength": 1-10,
  "has_faces": true/false,
  "notes": "one short phrase describing what's happening"
}

Score technical_quality on focus, lighting, and composition only. Score emotional_strength on how much this photo captures a genuine, storyworthy moment (candid laughter, meaningful glances, celebration) versus a generic/staged shot.`;

  const raw = await callClaude([
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        { type: "text", text: prompt },
      ],
    },
  ]);

  return parseJsonSafely(raw);
}

// ---------- Stage 2: Story-arc assembly ----------

async function buildStoryArc(photoResults, eventContext) {
  const summary = photoResults.map((p) => ({
    file: p.file,
    moment_type: p.analysis.moment_type,
    emotional_strength: p.analysis.emotional_strength,
    technical_quality: p.analysis.technical_quality,
    notes: p.analysis.notes,
  }));

  const prompt = `You are a video editor's assistant building a story arc for an event recap video.

Event: ${eventContext.eventType} — "${eventContext.eventName}"
Style requested: ${eventContext.style}

Here is the analyzed photo/moment data from guest uploads:
${JSON.stringify(summary, null, 2)}

Respond ONLY with a JSON object (no preamble, no markdown fences) with this shape:

{
  "shortlist": ["filename1", "filename2", ...],   // best 15-25 shots, deduplicated by similar moment_type + notes, ranked by combined quality+emotion
  "story_arc": [
    { "section": "Opening", "files": ["filename..."], "note": "why these open the video" },
    { "section": "Build", "files": ["filename..."], "note": "..." },
    { "section": "Peak moment", "files": ["filename..."], "note": "..." },
    { "section": "Close", "files": ["filename..."], "note": "..." }
  ],
  "title_card_text": "a short, warm title card line for the video open",
  "closing_card_text": "a short closing line"
}

Favor emotional_strength over technical_quality when choosing the shortlist, but exclude anything below 4/10 technical_quality unless it's a uniquely strong moment. Match the story_arc's tone to the requested style.`;

  const raw = await callClaude([{ role: "user", content: prompt }], 2048);
  return parseJsonSafely(raw);
}

// ---------- Main pipeline ----------

async function runPipeline(rawFolder, outputPath, eventContext) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY before running this script.");
  }

  const files = fs
    .readdirSync(rawFolder)
    .filter((f) => SUPPORTED_EXT.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    console.log("No supported image files found in", rawFolder);
    return;
  }

  console.log(`Analyzing ${files.length} photos...`);
  const photoResults = [];

  for (const file of files) {
    const fullPath = path.join(rawFolder, file);
    try {
      const analysis = await analyzePhoto(fullPath);
      photoResults.push({ file, analysis });
      console.log(`  ✓ ${file} — quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}, ${analysis.moment_type}`);
    } catch (err) {
      console.error(`  ✗ ${file} — analysis failed:`, err.message);
    }
  }

  console.log("\nBuilding story arc from analyzed shots...");
  const storyArc = await buildStoryArc(photoResults, eventContext);

  const report = {
    event: eventContext,
    generatedAt: new Date().toISOString(),
    totalPhotosAnalyzed: photoResults.length,
    perPhoto: photoResults,
    curation: storyArc,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nDone. Report saved to ${outputPath}`);
  console.log(`Shortlist: ${storyArc.shortlist.length} shots selected for editor review.`);
}

// ---------- CLI entry point ----------

if (require.main === module) {
  const [, , rawFolder, outputPath] = process.argv;
  if (!rawFolder || !outputPath) {
    console.log("Usage: node curate.js <raw-photos-folder> <output-report.json>");
    process.exit(1);
  }

  // In production this event context would come from the booking record
  // (pulled from the same storage the booking form and dashboard use).
  const eventContext = {
    eventName: "Maya's 30th Birthday",
    eventType: "Birthday",
    style: "cinematic",
  };

  runPipeline(rawFolder, outputPath, eventContext).catch((err) => {
    console.error("Pipeline failed:", err.message);
    process.exit(1);
  });
}

module.exports = { analyzePhoto, buildStoryArc, runPipeline };
