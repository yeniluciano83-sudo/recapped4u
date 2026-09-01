/**
 * Recapped For You — Fully Automated Recap Pipeline
 * ----------------------------------------------------
 * Given a booking ID, this script does everything end-to-end with no
 * human editing step. Photos only -- guests upload photos, never video
 * (enforced at the upload API), so there's no raw footage to incorporate:
 *
 *   1. Pulls the booking's raw uploaded photos from Supabase + R2
 *   2. Sends every photo to Claude for curation (score + shortlist) as one
 *      Batch API request (50% cheaper than a call per photo, see
 *      lib/batchAnalysis.js) -- submitted in one run, picked back up in a
 *      later one once results are ready (see submitAnalysisBatch/
 *      resumeAnalysis below and processAnalyzingBookings in
 *      poll-and-recap.js)
 *   3. Auto-enhances the shortlisted photos (color, sharpness, style grade)
 *   4. Assembles an automated slideshow video (Ken Burns + crossfades + a
 *      royalty-free soundtrack matched to the booking's editing style)
 *   5. Uploads the finished photos + video to R2 under a deliverable/ path
 *   6. Writes the `deliverables` row and flips the booking to "delivered"
 *
 * Run: node scripts/auto-recap.js <bookingId>          (submits a batch and
 *        blocks, polling, until it's done -- fine for a manual run, but
 *        poll-and-recap.js's cron job never has that long; see below)
 *      node scripts/auto-recap.js submit <bookingId>   (submit only)
 *      node scripts/auto-recap.js resume <bookingId>   (check/continue once)
 */
require("dotenv").config({ path: require("path").join(__dirname,"..",".env.local"), quiet: true });
const { captureError, flushSentry } = require("../lib/sentry");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
// See the matching comment in lib/video-assemble.js -- ffmpeg-static's
// Linux binary is missing the drawtext filter, so CI sets FFMPEG_PATH to
// a real system ffmpeg instead.
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || require("ffmpeg-static"));
const { createClient } = require("@supabase/supabase-js");
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const { enhancePhoto } = require("../lib/photo-enhance");
const { assembleSlideshow, extractPosterFrame } = require("../lib/video-assemble");
const { generateRoastScript } = require("../lib/roast");
const { buildOutroBackground } = require("../lib/outro-card");
const { buildSocialSelections } = require("../lib/socialSelections");
const { computeGalleryExpiry } = require("../lib/galleryExpiry");
const {
  ANALYSIS_PROMPT,
  parseAnalysisJson,
  buildAnalysisRequest,
  BATCH_FALLBACK_HOURS,
  shouldFallBackToSyncAnalysis,
  parseBatchResults,
} = require("../lib/batchAnalysis");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Tracks the active run's temp dir so the top-level error handlers can
// clean it up on ANY thrown error, not just the spots inside
// continuePipelineWithAnalysis that already do this manually (leaving
// every other error path -- a failed enhancePhoto/uploadToR2/
// generateRoastScript/finalizeDelivery call -- to leak the downloaded/
// enhanced JPEGs on disk). Safe as a module-level variable only because
// this script processes one booking per process invocation (see
// poll-and-recap.js's execSync calls), never concurrent bookings in the
// same process.
let currentTmpDir = null;

// Royalty-free tracks (Pixabay Content License — free for commercial use,
// no attribution required), one per editing style, matching the mood
// described for that style on the booking page. Living under public/
// (rather than lib/) so the same files double as browser-playable style
// previews on the booking and QR share pages -- see MUSIC_PREVIEW_URL in
// app/booking/page.jsx and app/qr/[slug]/page.jsx.
const STYLE_MUSIC = {
  cinematic: path.join(__dirname, "..", "public", "music", "cinematic.mp3"),
  upbeat: path.join(__dirname, "..", "public", "music", "upbeat.mp3"),
  documentary: path.join(__dirname, "..", "public", "music", "documentary.mp3"),
  retro: path.join(__dirname, "..", "public", "music", "retro.mp3"),
  highlight: path.join(__dirname, "..", "public", "music", "highlight.mp3"),
};

// The actual *edit* per style -- transition, pacing, grain -- passed through
// to assembleSlideshow's styleConfig (lib/video-assemble.js). Previously
// style only changed the color grade (STYLE_ADJUSTMENTS in
// lib/photo-enhance.js) and the music track above; every style rendered
// with an identical 0.6s fade at an identical 4s pace regardless of which
// one a host picked. transitionSeconds here also feeds the duration-solving
// math below (fullCutSlotSeconds, and the social cut's slotSeconds) -- it
// must be the actual value passed to assembleSlideshow for a given style,
// or the rendered video's real length silently drifts from its target.
const STYLE_VIDEO_CONFIG = {
  cinematic: { transitionType: "fade", transitionSeconds: 0.6, slotSeconds: 4, grain: false },
  // Faster pace + a snappier slide (vs. a fade) reads as "fast cuts, high energy" -- true audio beat-sync would be a much bigger feature on its own.
  upbeat: { transitionType: "slideleft", transitionSeconds: 0.25, slotSeconds: 2.5, grain: false },
  // A near-instant fade reads as a hard cut -- "minimal, candid, true to the moment" gets the least stylized transition of any of them.
  documentary: { transitionType: "fade", transitionSeconds: 0.15, slotSeconds: 4, grain: false },
  retro: { transitionType: "dissolve", transitionSeconds: 0.9, slotSeconds: 4, grain: true },
  highlight: { transitionType: "circleopen", transitionSeconds: 0.3, slotSeconds: 2.5, grain: false },
};

function styleVideoConfigFor(style) {
  return STYLE_VIDEO_CONFIG[style] || STYLE_VIDEO_CONFIG.documentary;
}

// Highlight Reel's "bold text call-outs" -- reuses the moment_type every
// photo already got from its Claude analysis (ANALYSIS_PROMPT in
// lib/batchAnalysis.js), otherwise unused after shortlisting. No new
// Claude call needed. Uppercased/truncated for a punchy, sports-broadcast-
// style label rather than a full sentence.
const MAX_CALLOUT_CHARS = 28;
function highlightCallout(momentType) {
  if (!momentType) return null;
  const upper = momentType.toUpperCase();
  return upper.length > MAX_CALLOUT_CHARS ? `${upper.slice(0, MAX_CALLOUT_CHARS - 1)}…` : upper;
}

// Same moment_type reuse for the gallery page's per-photo caption -- Title
// Case rather than highlightCallout's all-caps (a caption sits next to real
// photos in a browsing UI, not burned into video as a broadcast-style
// graphic), and a longer cap since a gallery caption isn't fighting for
// space over the photo itself the way an on-screen overlay is.
const MAX_GALLERY_CAPTION_CHARS = 40;
function formatGalleryCaption(momentType) {
  if (!momentType) return null;
  const titleCased = momentType.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return titleCased.length > MAX_GALLERY_CAPTION_CHARS ? `${titleCased.slice(0, MAX_GALLERY_CAPTION_CHARS - 1)}…` : titleCased;
}

// Builds the overlayLines array assembleSlideshow expects (parallel to the
// photo list) for whichever style is in play -- null for every style but
// Highlight Reel (a call-out per photo, top-center) and Retro (a single
// vintage event-type label on the first photo only, top-left). Every other
// style gets an array of nulls, which assembleSlideshow treats as "no
// overlay" the same as passing null itself.
function buildOverlayLines(style, entries, eventType) {
  if (style === "highlight") {
    return entries.map((e) => {
      const text = highlightCallout(e.analysis && e.analysis.moment_type);
      return text ? { text, position: "top-center", fontColor: "white", boxColor: "black@0.6" } : null;
    });
  }
  if (style === "retro" && entries.length > 0) {
    return entries.map((_, i) =>
      i === 0 ? { text: `— ${eventType.toUpperCase()} —`, position: "top-left", fontColor: "#F4E8D8", boxColor: "#3B2A1A@0.65" } : null
    );
  }
  return entries.map(() => null);
}

// The closing card's sign-off line -- same for every style (this is a
// universal polish item, not a per-style stylistic choice, unlike
// highlightCallout/the retro title above). Rendered centered on its own
// dedicated backdrop (see buildOutroBackground in lib/outro-card.js), not
// squeezed onto the last real photo, so it never has to compete with a
// roast line or a style's own overlay for space.
function outroOverlayText(hostName, eventType) {
  return `Thank you for celebrating ${hostName}'s ${eventType}`;
}

// Spotlight/Luxe only, matching what those tiers actually advertise.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
const TARGET_SOCIAL_SECONDS = 75; // middle of the advertised 60-90s range
// Both tiers get multiple social cuts, each from a different batch of top
// photos (cut 1 = must-includes + best remaining, cut 2 = next-best batch,
// and so on) -- real distinct content per cut, not just re-edits of the
// same shots.
const SOCIAL_CUTS_COUNT = { premium: 5, keepsake: 10 };

// Paid tiers advertise unlimited uploads with no stated gallery cap, so
// their shortlist is genuinely uncapped -- every photo that clears the
// technical_quality bar in buildShortlist makes it in, how ever many that
// is. Only Free has a real, advertised cap (up to 20 photos). A paying
// customer's gallery being smaller than Free's was a real bug, not an
// acceptable default -- see the SHORTLIST_CAP lookup below.
const SHORTLIST_CAP = { free: 20 };
const FULL_CUT_TARGET_SECONDS = { free: 75 }; // middle of the advertised 60-90s range

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;

async function downloadFromR2(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function uploadToR2(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return key;
}

// Grabs a poster frame from a just-rendered video and uploads it under the
// same deliverable/ prefix -- one per rendered file (not shared between a
// roast-captioned cut and its caption-free twin), since a frame grabbed
// from the captioned version can genuinely have caption text baked into it.
async function uploadPosterFor(videoLocalPath, tmpDir, posterKey) {
  const posterLocalPath = path.join(tmpDir, `${path.basename(videoLocalPath, ".mp4")}-poster.jpg`);
  await extractPosterFrame(videoLocalPath, posterLocalPath);
  const posterBuffer = fs.readFileSync(posterLocalPath);
  await uploadToR2(posterKey, posterBuffer, "image/jpeg");
  return posterKey;
}

async function deleteFromR2(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Used to recover the social cut's photo selection a prior run already
// uploaded, without re-analyzing/re-enhancing it -- it survives a reprocess
// this way, since finalizeDelivery may run in a completely separate process
// invocation (e.g. a manual re-run) from whatever run originally uploaded it.
async function listDeliverableFiles(bookingId, prefix) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `deliverable/${bookingId}/${prefix}` }));
  // A plain string sort puts "photo-10.jpg" before "photo-2.jpg" -- fine
  // when this only ever listed a single social cut (capped at 15), but now
  // that it also recovers the full gallery (easily 20+ photos), that would
  // visibly scramble gallery order. Sort by the trailing number instead.
  return (res.Contents || [])
    .map((o) => o.Key)
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)\.\w+$/)?.[1] || "0", 10);
      const numB = parseInt(b.match(/(\d+)\.\w+$/)?.[1] || "0", 10);
      return numA - numB;
    });
}

// Recent-joke-history support for lib/roast.js's generateRoastScript --
// that module deliberately has no database access of its own, so this
// script (which already has the supabase connection) fetches history
// before each call and logs the new lines after. Reading this fresh
// before every generateRoastScript call -- not once per booking -- means
// a Luxe booking's later social cuts also see lines generated by its own
// earlier cuts in the same run, not just other bookings.
const RECENT_ROAST_LINES_LOOKBACK = 40;

async function fetchRecentRoastLines() {
  const { data, error } = await supabase
    .from("roast_lines")
    .select("line")
    .order("created_at", { ascending: false })
    .limit(RECENT_ROAST_LINES_LOOKBACK);
  if (error) {
    // Missing table/connection issue shouldn't block Roast Reel generation
    // entirely -- this is a "nice to have less repetition" feature, not a
    // correctness requirement.
    console.error("Failed to fetch recent roast lines (continuing without history):", error.message);
    return [];
  }
  return (data || []).map((r) => r.line);
}

async function saveRoastLines(bookingId, eventType, roastLevel, lines) {
  if (!lines || lines.length === 0) return;
  const rows = lines.map((line) => ({ booking_id: bookingId, event_type: eventType, roast_level: roastLevel, line }));
  const { error } = await supabase.from("roast_lines").insert(rows);
  if (error) console.error("Failed to save roast lines (continuing):", error.message);
}

async function callClaude(messages, maxTokens = 1024) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-opus-5", max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.find((b) => b.type === "text")?.text || "";
}

// Synchronous, one-call-per-photo analysis -- the only path this pipeline
// had until the Batch API was wired in. Kept as analyzePhotosSynchronously'
// fallback for a booking whose batch is taking unusually long (see
// shouldFallBackToSyncAnalysis), so it still shares the exact prompt
// (ANALYSIS_PROMPT) and parsing (parseAnalysisJson) the batch path uses,
// via lib/batchAnalysis.js, so the two can never silently drift apart.
// `flagged`/`flag_reason` implement the "Acceptable use" terms (sexually
// explicit content or nudity isn't allowed) -- checked on every photo.
async function analyzePhoto(buffer, mediaType) {
  const raw = await callClaude([
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }, { type: "text", text: ANALYSIS_PROMPT }] },
  ]);
  return parseAnalysisJson(raw);
}

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

async function anthropicFetch(urlPath, options = {}) {
  const res = await fetch(`${ANTHROPIC_API_BASE}${urlPath}`, {
    ...options,
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status} (${urlPath}): ${await res.text()}`);
  return res;
}

async function createAnalysisBatch(requests) {
  const res = await anthropicFetch("/messages/batches", { method: "POST", body: JSON.stringify({ requests }) });
  return res.json();
}

async function getBatch(batchId) {
  const res = await anthropicFetch(`/messages/batches/${batchId}`);
  return res.json();
}

// Streams the batch's .jsonl results and returns them as an array of
// parsed-JSON lines -- an event with up to 2000 photos comfortably fits in
// memory this way (each line is a short analysis object, not the photo
// itself), so this skips the true streaming the Batches API docs recommend
// for much larger batches than this pipeline ever produces.
async function fetchBatchResults(resultsUrl) {
  const res = await fetch(resultsUrl, {
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`Failed to fetch batch results: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text.split("\n").filter(Boolean);
}

// Terms of Service, "Acceptable use": we can reject specific photos/videos
// for nudity or sexually explicit content. Flagged uploads are removed
// from R2 and the uploads table entirely -- not just excluded from the
// shortlist -- so they don't linger in storage or get a second look. Used
// by both the synchronous and batch-result analysis paths.
async function rejectFlaggedUpload(upload, analysis, label) {
  console.log(`  ⚠ ${upload.storage_key}${label} — flagged (${analysis.flag_reason || "inappropriate content"}), removing`);
  try {
    await deleteFromR2(upload.storage_key);
  } catch (err) {
    console.error(`    failed to delete ${upload.storage_key} from R2: ${err.message}`);
  }
  await supabase.from("uploads").delete().eq("id", upload.id);
}

async function recordAnalysisFailure(bookingId, upload, errorMessage) {
  console.error(`  ✗ ${upload.storage_key} — analysis failed: ${errorMessage}`);
  // Best-effort: a failure logging the failure shouldn't crash the
  // per-photo loop itself -- the console.error above is the fallback.
  try {
    await supabase.from("upload_analysis_failures").insert({
      booking_id: bookingId,
      upload_id: upload.id,
      storage_key: upload.storage_key,
      error_message: errorMessage,
    });
  } catch (logErr) {
    console.error(`    failed to record analysis failure for ${upload.storage_key}: ${logErr.message}`);
  }
}

async function fetchPhotoUploads(bookingId) {
  const { data: uploads, error } = await supabase.from("uploads").select("*").eq("booking_id", bookingId);
  if (error) throw error;
  if (!uploads || uploads.length === 0) throw new Error("No uploads found for this booking");
  return uploads.filter((u) => u.file_type === "photo");
}

// Claude's vision input only accepts jpeg/png/gif/webp. Guest uploads are
// only restricted to image/* client-side (see app/api/events/[eventId]/
// upload/route.js), so anything else -- HEIC/HEIF above all, the default
// photo format on every iPhone -- has to be actually converted, not just
// relabeled. Confirmed live: a request declaring raw HEIC bytes as
// image/jpeg is what produced a real guest-facing "Could not process
// image" analysis failure.
const CLAUDE_IMAGE_MEDIA_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

async function toClaudeCompatibleImage(buffer, storageKey) {
  const ext = path.extname(storageKey).toLowerCase();
  const knownType = CLAUDE_IMAGE_MEDIA_TYPES[ext];
  if (knownType) return { buffer, mediaType: knownType };

  // HEIC/HEIF (or anything else unrecognized) -- convert to JPEG. This can
  // still throw for a genuinely undecodable file (confirmed live: some
  // iPhone Portrait/Live Photo HEIC variants trip up libheif's decoder even
  // though the file itself isn't corrupt) -- callers already wrap this in
  // the same try/catch that records a normal analysis failure, so that
  // case degrades exactly as before, just with an accurate error message
  // now instead of a silent mislabeled-media-type one.
  const jpegBuffer = await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer();
  return { buffer: jpegBuffer, mediaType: "image/jpeg" };
}

// The old, fully synchronous analysis path -- one Claude call per photo,
// blocking. No longer the default (see submitAnalysisBatch), but kept as
// the fallback resumeAnalysis reaches for when a booking's batch has been
// processing for longer than BATCH_FALLBACK_HOURS, so a slow batch can
// never cost a booking its promised turnaround.
async function analyzePhotosSynchronously(bookingId) {
  const photoUploads = await fetchPhotoUploads(bookingId);
  console.log(`Analyzing ${photoUploads.length} photo(s) synchronously (batch fallback)...`);

  const analyzed = [];
  for (const upload of photoUploads) {
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      const claudeImage = await toClaudeCompatibleImage(buffer, upload.storage_key);
      const analysis = await analyzePhoto(claudeImage.buffer, claudeImage.mediaType);
      if (analysis.flagged) {
        await rejectFlaggedUpload(upload, analysis, "");
        continue;
      }
      // The ORIGINAL buffer, not the Claude-only JPEG conversion above --
      // enhancePhoto downstream should work from the real uploaded bytes,
      // not a copy re-encoded just to satisfy Claude's supported formats.
      analyzed.push({ upload, buffer, analysis });
      console.log(`  ✓ ${upload.storage_key} — quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}`);
    } catch (err) {
      await recordAnalysisFailure(bookingId, upload, err.message);
    }
  }
  return analyzed;
}

// Phase 1 of the batched pipeline: downloads every raw photo, submits one
// Message Batch request per photo, and stores the batch id -- then returns
// immediately without waiting. See resumeAnalysis for phase 2.
async function submitAnalysisBatch(bookingId) {
  console.log(`Submitting analysis batch for booking ${bookingId}`);

  const { data: booking, error: bookingErr } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingErr || !booking) throw new Error("Booking not found");

  // Set here (not just by poll-and-recap.js's claim) so a manual
  // `node scripts/auto-recap.js submit <id>` run -- which never goes
  // through that claim -- is also covered by the stale-booking recovery in
  // recoverStaleBookings().
  await supabase.from("bookings").update({ status: "analyzing", processing_started_at: new Date().toISOString() }).eq("id", bookingId);

  const photoUploads = await fetchPhotoUploads(bookingId);
  console.log(`Found ${photoUploads.length} raw photos. Downloading and building the analysis batch...`);

  const requests = [];
  for (const upload of photoUploads) {
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      const claudeImage = await toClaudeCompatibleImage(buffer, upload.storage_key);
      requests.push(buildAnalysisRequest(upload.id, claudeImage.buffer, claudeImage.mediaType));
    } catch (err) {
      await recordAnalysisFailure(bookingId, upload, `Failed to prepare photo for batch submission: ${err.message}`);
    }
  }

  if (requests.length === 0) {
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null, batch_id: null }).eq("id", bookingId);
    throw new Error(`No downloadable photos for booking ${bookingId} -- reverted status to "collecting".`);
  }

  const batch = await createAnalysisBatch(requests);
  console.log(`Batch ${batch.id} submitted with ${requests.length} photo(s), status: ${batch.processing_status}`);

  await supabase.from("bookings").update({ batch_id: batch.id }).eq("id", bookingId);
}

// Turns a finished batch's results into the same { upload, buffer,
// analysis } shape analyzePhotosSynchronously produces -- re-downloads each
// non-flagged photo's buffer from R2 since phase 1's buffers don't survive
// across a process boundary (submit and resume can run in entirely
// separate poll-and-recap.js ticks, hours apart).
async function buildAnalyzedFromBatchResults(bookingId, resultsUrl) {
  const photoUploads = await fetchPhotoUploads(bookingId);
  const resultLines = await fetchBatchResults(resultsUrl);
  const resultsByUploadId = parseBatchResults(resultLines);

  const analyzed = [];
  for (const upload of photoUploads) {
    const result = resultsByUploadId.get(upload.id);
    if (!result) {
      // Every photo submitted in the batch gets exactly one custom_id-
      // matched result, even on failure -- shouldn't happen, but skip
      // rather than crash the whole booking if it ever does.
      console.error(`  ✗ ${upload.storage_key} — no batch result found, skipping`);
      continue;
    }
    if (result.error) {
      await recordAnalysisFailure(bookingId, upload, result.error);
      continue;
    }
    if (result.analysis.flagged) {
      await rejectFlaggedUpload(upload, result.analysis, " (batch)");
      continue;
    }
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      analyzed.push({ upload, buffer, analysis: result.analysis });
      console.log(`  ✓ ${upload.storage_key} — quality ${result.analysis.technical_quality}, emotion ${result.analysis.emotional_strength}`);
    } catch (err) {
      await recordAnalysisFailure(bookingId, upload, `Download failed after batch analysis: ${err.message}`);
    }
  }
  return analyzed;
}

// Phase 2: called once per poll-and-recap.js tick for every "analyzing"
// booking. Checks the booking's batch; if it's ended, builds `analyzed`
// from the results and continues the pipeline. If it's still running and
// past BATCH_FALLBACK_HOURS, falls back to the old synchronous path
// instead of waiting any longer. Otherwise does nothing this tick.
// Returns true if it took a terminal action (continued the pipeline),
// false if the batch is still healthy and just needs more time.
async function resumeAnalysis(bookingId) {
  const { data: booking, error: bookingErr } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingErr || !booking) throw new Error("Booking not found");

  if (booking.status !== "analyzing") {
    console.log(`Booking ${bookingId} is no longer "analyzing" (status: ${booking.status}) -- nothing to resume.`);
    return true;
  }
  if (!booking.batch_id) throw new Error(`Booking ${bookingId} is "analyzing" but has no batch_id`);

  const batch = await getBatch(booking.batch_id);
  console.log(`Batch ${booking.batch_id} for booking ${bookingId}: ${batch.processing_status} (${JSON.stringify(batch.request_counts)})`);

  let analyzed;
  if (batch.processing_status === "ended") {
    analyzed = await buildAnalyzedFromBatchResults(bookingId, batch.results_url);
  } else if (shouldFallBackToSyncAnalysis(booking.processing_started_at)) {
    console.log(`Batch ${booking.batch_id} has been processing for over ${BATCH_FALLBACK_HOURS}h -- falling back to synchronous per-photo analysis for booking ${bookingId}.`);
    analyzed = await analyzePhotosSynchronously(bookingId);
  } else {
    console.log(`Batch ${booking.batch_id} still processing -- will check again next run.`);
    return false;
  }

  await supabase.from("bookings").update({ status: "editing", processing_started_at: new Date().toISOString(), batch_id: null }).eq("id", bookingId);
  await continuePipelineWithAnalysis(booking, analyzed);
  return true;
}

// A photo can be emotionally beautiful but score low on technical_quality
// alone (motion blur, backlighting, off-center framing) and get cut here
// even though it stays in the gallery (buildGallerySelection, no quality
// filter). must_include (set by the host via app/qr/[slug]/page.jsx) is a
// direct override for exactly that case -- starred photos always make the
// cut regardless of score, same precedent as must_include_social below for
// the social cut specifically.
async function buildShortlist(analyzed, maxPhotos = 15) {
  const starred = analyzed.filter((p) => p.upload.must_include);
  const starredIds = new Set(starred.map((p) => p.upload.id));
  const rest = analyzed
    .filter((p) => !starredIds.has(p.upload.id) && p.analysis.technical_quality >= 4)
    .sort((a, b) => (b.analysis.emotional_strength + b.analysis.technical_quality) - (a.analysis.emotional_strength + a.analysis.technical_quality));
  return [...starred, ...rest].slice(0, maxPhotos);
}

// The gallery always shows every non-flagged uploaded photo -- unlike the
// curated video, a low technical_quality score never excludes a photo here.
// Free is the one tier with a real, advertised cap (20); paid tiers get
// everything. When a cap does apply, the highest-ranked photos are kept.
function buildGallerySelection(analyzed, cap) {
  const ranked = [...analyzed].sort(
    (a, b) => (b.analysis.emotional_strength + b.analysis.technical_quality) - (a.analysis.emotional_strength + a.analysis.technical_quality)
  );
  return cap === Infinity ? ranked : ranked.slice(0, cap);
}

// Manual-run-only: blocks and polls resumeAnalysis until the batch
// submitAnalysisBatch just kicked off finishes (or the fallback threshold
// is reached), then returns once the rest of the pipeline has run. Fine
// for an operator running this by hand, but poll-and-recap.js never calls
// this -- its cron job has a hard 20-minute budget (see
// .github/workflows/recap-scheduler.yml), far shorter than a batch can
// take, so it calls submitAnalysisBatch and resumeAnalysis as two separate
// steps across separate scheduled ticks instead (see
// processAnalyzingBookings there).
const MANUAL_POLL_INTERVAL_MS = 30_000;
async function waitForAnalysisAndContinue(bookingId) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const done = await resumeAnalysis(bookingId);
    if (done) return;
    await new Promise((resolve) => setTimeout(resolve, MANUAL_POLL_INTERVAL_MS));
  }
}

async function withStatusRevertOnFailure(bookingId, fn) {
  try {
    return await fn();
  } catch (err) {
    // Without this, any failure partway through submitting/resuming/
    // continuing leaves the booking stuck at "analyzing" or "editing"
    // forever -- processCollectingBookings only re-queries
    // status === "collecting", so nothing would ever retry it
    // automatically. Revert so the next scheduled run picks it back up.
    // Guarded per-status so this can't clobber a status change that
    // happened for another reason mid-run (e.g. continuePipelineWithAnalysis's
    // own zero-shortlist case already reverts to "collecting" itself, or the
    // host cancelled the booking while this was running).
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null, batch_id: null }).eq("id", bookingId).eq("status", "analyzing");
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null }).eq("id", bookingId).eq("status", "editing");
    if (currentTmpDir) {
      fs.rmSync(currentTmpDir, { recursive: true, force: true });
      currentTmpDir = null;
    }
    throw err;
  }
}

async function runAutoRecap(bookingId) {
  console.log(`Starting automated recap for booking ${bookingId}`);
  return withStatusRevertOnFailure(bookingId, async () => {
    await submitAnalysisBatch(bookingId);
    await waitForAnalysisAndContinue(bookingId);
  });
}

async function runSubmitOnly(bookingId) {
  return withStatusRevertOnFailure(bookingId, () => submitAnalysisBatch(bookingId));
}

async function runResumeOnly(bookingId) {
  return withStatusRevertOnFailure(bookingId, () => resumeAnalysis(bookingId));
}

// The back half of the pipeline -- everything that happens once a photo's
// analysis is known, regardless of whether it came from a finished batch
// or the synchronous fallback. Unchanged in behavior from before the Batch
// API was wired in; only the analysis step above it changed.
async function continuePipelineWithAnalysis(booking, analyzed) {
  const bookingId = booking.id;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-"));
  currentTmpDir = tmpDir;

  // Spotlight/Luxe can choose "social cuts of every photo" instead of a
  // curated full video (booking.delivery_format) -- in that mode there's no
  // quality-gated shortlist or full-cut video at all, just as many social
  // cuts as it takes to cover every non-flagged upload (buildSocialSelections
  // below, given an uncapped cut count).
  const useAllPhotoSocialCuts = SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier) && booking.delivery_format === "social_cuts";

  let videoShortlist = [];
  if (!useAllPhotoSocialCuts) {
    videoShortlist = await buildShortlist(analyzed, SHORTLIST_CAP[booking.tier] || Infinity);
    console.log(`Shortlisted ${videoShortlist.length} photos for the final cut.`);

    if (videoShortlist.length === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await supabase.from("bookings").update({ status: "collecting", processing_started_at: null }).eq("id", bookingId);
      throw new Error(
        `No photos met the quality threshold for booking ${bookingId} -- reverted status to "collecting".`
      );
    }
  } else if (analyzed.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null }).eq("id", bookingId);
    throw new Error(`No usable photos (after moderation) for booking ${bookingId} -- reverted status to "collecting".`);
  }

  // The gallery always shows every non-flagged uploaded photo -- see
  // buildGallerySelection. This is a superset of videoShortlist (which stays
  // quality-gated for the actual video), so the video's local files below
  // reuse these already-enhanced buffers instead of enhancing twice.
  console.log("Auto-enhancing all uploaded photos for the gallery...");
  const gallerySelection = buildGallerySelection(analyzed, SHORTLIST_CAP[booking.tier] || Infinity);
  const galleryCaptions = gallerySelection.map((s) => formatGalleryCaption(s.analysis && s.analysis.moment_type));
  const enhancedKeys = [];
  const enhancedByUploadId = new Map();
  const enhancedKeyByUploadId = new Map();

  for (let i = 0; i < gallerySelection.length; i++) {
    const { buffer, upload } = gallerySelection[i];
    const enhanced = await enhancePhoto(buffer, booking.style);
    const key = `deliverable/${bookingId}/photo-${i + 1}.jpg`;
    await uploadToR2(key, enhanced, "image/jpeg");
    enhancedKeys.push(key);
    enhancedByUploadId.set(upload.id, enhanced);
    enhancedKeyByUploadId.set(upload.id, key);
  }

  const localPaths = [];
  const videoStorageKeys = [];
  for (let i = 0; i < videoShortlist.length; i++) {
    const { upload } = videoShortlist[i];
    const enhanced = enhancedByUploadId.get(upload.id);
    const localPath = path.join(tmpDir, `video-photo-${i + 1}.jpg`);
    fs.writeFileSync(localPath, enhanced);
    localPaths.push(localPath);
    videoStorageKeys.push(enhancedKeyByUploadId.get(upload.id));
  }

  // The social cut's photo selection can include host-starred photos that
  // didn't make the main shortlist -- upload the whole selection under its
  // own R2 prefix now, so a reprocess survives it: finalizeDelivery recovers
  // the actual PHOTO BYTES by listing rather than needing anything still in
  // memory from this run. socialSelections itself (each entry's .analysis,
  // used for Highlight Reel's overlay text -- see buildOverlayLines) is
  // still passed through directly below: it's only ever built once per
  // continuePipelineWithAnalysis call, immediately before the upload it
  // describes, so it can't drift out of sync with what actually landed in
  // R2 the way relying on stale in-memory state across separate runs could.
  //
  // "video_only" delivery format skips this entirely -- no social-*-photo-*
  // files ever get uploaded, so finalizeDelivery's own listDeliverableFiles
  // loop (the only other place that looks at social cuts) finds nothing on
  // its very first prefix and stops immediately, naturally producing zero
  // social cuts without needing a second check there.
  let socialSelections = [];
  if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier) && booking.delivery_format !== "video_only") {
    const socialCutsCount = useAllPhotoSocialCuts ? Infinity : (SOCIAL_CUTS_COUNT[booking.tier] || 1);
    socialSelections = buildSocialSelections(analyzed, socialCutsCount);
    console.log(`Uploading photos for ${socialSelections.length} social cut selection(s)...`);
    for (let cutIndex = 0; cutIndex < socialSelections.length; cutIndex++) {
      for (let i = 0; i < socialSelections[cutIndex].length; i++) {
        const { buffer, upload } = socialSelections[cutIndex][i];
        const enhanced = enhancedByUploadId.get(upload.id) || (await enhancePhoto(buffer, booking.style));
        // "social-{n}-photo-", not "social-" -- a plain "social-" prefix
        // also matches the rendered "social-cut-{n}.mp4" outputs further
        // down (an S3 prefix listing has no concept of "photos only").
        // Harmless on a booking's first delivery since those files don't
        // exist yet when this uploads, but on a reprocess they're already
        // sitting in R2 from the prior run, get listed alongside the real
        // photos below, and ffmpeg rejects them with "Option loop not
        // found" when fed in as an image input -- confirmed live
        // reprocessing a real booking (see the single-cut version of this
        // same bug that motivated the "-photo-" suffix in the first place).
        await uploadToR2(`deliverable/${bookingId}/social-${cutIndex + 1}-photo-${i + 1}.jpg`, enhanced, "image/jpeg");
      }
    }
  }

  // Roast Reel captions the full video -- there's no full video to caption
  // in "social cuts of every photo" mode, so this (the full-video script)
  // is skipped there even if roast_enabled is set. Social cuts get their
  // own roast script generated separately, per cut, inside finalizeDelivery
  // -- see the comment there. Every intensity level's prompt (lib/roast.js)
  // carries a hard rule to roast the moment, never a person's body/
  // appearance/race, so the script needs no separate host review before
  // it's used.
  let roastLines = null;
  if (booking.roast_enabled && !useAllPhotoSocialCuts) {
    console.log("Roast Reel add-on enabled -- generating full-video script...");
    const roastPhotos = localPaths.map((p, i) => ({ buffer: fs.readFileSync(p), storageKey: videoStorageKeys[i] }));
    const recentLines = await fetchRecentRoastLines();
    const script = await generateRoastScript(roastPhotos, {
      eventType: booking.event_type,
      roastLevel: booking.roast_level || "light",
      recentLines,
    });
    roastLines = script.map((line) => line.line);
    await saveRoastLines(bookingId, booking.event_type, booking.roast_level || "light", roastLines);
  }

  // Style is optional at booking time (see app/booking/page.jsx) -- an
  // unset style still needs *some* soundtrack rather than silently
  // shipping a music-less video, so it falls back to documentary's track,
  // matching enhancePhoto's own documentary default for the color grade.
  const musicPath = booking.full_video_no_music ? null : STYLE_MUSIC[booking.style] || STYLE_MUSIC.documentary;
  const socialMusicPath = booking.social_style === "none" ? null : STYLE_MUSIC[booking.social_style || booking.style] || STYLE_MUSIC.documentary;
  await finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, booking.email, booking.host_name, booking.tier, socialMusicPath, useAllPhotoSocialCuts, booking.roast_enabled, booking.roast_level, booking.event_type, booking.style, booking.social_style, videoShortlist, socialSelections, galleryCaptions);
  currentTmpDir = null;
}

async function finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, hostEmail, hostName, tier, socialMusicPath, skipFullVideo = false, roastEnabled = false, roastLevel = "light", eventType = "", style = "documentary", socialStyle = "", videoShortlist = [], socialSelections = [], galleryCaptions = []) {
  let videoKey = null;
  let noRoastVideoKey = null;
  let videoPosterKey = null;
  let noRoastVideoPosterKey = null;

  const styleConfigForVideo = styleVideoConfigFor(style);
  const effectiveSocialStyle = socialStyle || style;
  const socialStyleConfig = styleVideoConfigFor(effectiveSocialStyle);

  // "Social cuts of every photo" delivery format has no full video at all --
  // see useAllPhotoSocialCuts in continuePipelineWithAnalysis, the only
  // caller that ever passes skipFullVideo = true.
  if (!skipFullVideo) {
    console.log("Assembling automated slideshow video...");
    const videoLocalPath = path.join(tmpDir, "recap.mp4");

    // Closing card, appended as one more slot after the real photos -- see
    // lib/outro-card.js. A local variable, not a mutation of the localPaths
    // parameter, so anything else that might still read localPaths (there
    // is nothing left that does at this point, but keeping it untouched is
    // one less thing to reason about) is unaffected.
    const outroBackground = await buildOutroBackground(fs.readFileSync(localPaths[localPaths.length - 1]));
    const outroPath = path.join(tmpDir, "outro-card.jpg");
    fs.writeFileSync(outroPath, outroBackground);
    const localPathsWithOutro = [...localPaths, outroPath];

    // Free's highlight video targets a duration (like the social cut) rather
    // than the other tiers' fixed per-photo pacing that scales with however
    // many photos made the shortlist (now including the outro card, so it
    // counts as one of the slots the target duration is solved across,
    // rather than pushing the video past its target). Same duration-solving
    // math as the social cut; see the comment further down for the formula
    // itself. Uses this style's actual transitionSeconds, not a hardcoded
    // 0.6 -- using the wrong value here would land the rendered video's
    // real length short or long of fullCutTarget, since assembleSlideshow
    // below is given that same styleConfigForVideo.transitionSeconds to
    // render with.
    const fullCutTarget = FULL_CUT_TARGET_SECONDS[tier];
    const fullCutSlotSeconds = fullCutTarget
      ? (fullCutTarget + (localPathsWithOutro.length - 1) * styleConfigForVideo.transitionSeconds) / localPathsWithOutro.length
      : styleConfigForVideo.slotSeconds;

    // buildOverlayLines only returns one entry per REAL photo (videoShortlist's
    // length) -- extending it here, rather than there, keeps that function's
    // contract simple (one style's overlay per photo) and the outro's own
    // sign-off separate from any per-style callout/title logic.
    const overlayLines = [...buildOverlayLines(style, videoShortlist, eventType), { text: outroOverlayText(hostName, eventType), position: "center", fontColor: "white", boxColor: "black@0.45" }];
    await assembleSlideshow(localPathsWithOutro, [], videoLocalPath, musicPath, roastLines, fullCutSlotSeconds, { ...styleConfigForVideo, overlayLines });
    const videoBuffer = fs.readFileSync(videoLocalPath);
    videoKey = `deliverable/${bookingId}/full-cut.mp4`;
    await uploadToR2(videoKey, videoBuffer, "video/mp4");
    videoPosterKey = await uploadPosterFor(videoLocalPath, tmpDir, `deliverable/${bookingId}/full-cut-poster.jpg`);

    // Roast Reel bookings previously only ever got the captioned cut -- render
    // a second, caption-free twin of the exact same shortlist/pacing so hosts
    // can also share a version without the roast lines. Skipped for non-roast
    // bookings, where this would just be a duplicate of videoKey. Still
    // carries the style's own overlay (Highlight callouts / Retro title) and
    // the outro card -- only the roast captions are dropped, not those.
    if (roastLines) {
      console.log("Roast Reel enabled -- also assembling a caption-free version of the same cut...");
      const noRoastVideoLocalPath = path.join(tmpDir, "recap-no-roast.mp4");
      await assembleSlideshow(localPathsWithOutro, [], noRoastVideoLocalPath, musicPath, null, fullCutSlotSeconds, { ...styleConfigForVideo, overlayLines });
      const noRoastVideoBuffer = fs.readFileSync(noRoastVideoLocalPath);
      noRoastVideoKey = `deliverable/${bookingId}/full-cut-no-roast.mp4`;
      await uploadToR2(noRoastVideoKey, noRoastVideoBuffer, "video/mp4");
      noRoastVideoPosterKey = await uploadPosterFor(noRoastVideoLocalPath, tmpDir, `deliverable/${bookingId}/full-cut-no-roast-poster.jpg`);
    }
  } else {
    console.log("Delivery format is social cuts of every photo -- skipping the full recap video.");
  }

  // The social cut(s)' photo selections were already uploaded to R2 in
  // continuePipelineWithAnalysis -- recover them here rather than needing
  // anything still in memory from that run. If Roast Reel is enabled, each
  // cut gets its own roast script generated from its own photo selection
  // (cuts don't share a selection with each other or with the full video,
  // so the full-video script above can't just be reused/sliced), plus a
  // caption-free twin of that same cut, same as full_video_no_roast_key
  // already does for the full video. roast_enabled is a single
  // booking-level flag, not per-cut, so socialVideoNoRoastKeys always ends
  // up either fully populated (one entry per cut) or left empty -- never
  // partially populated -- which is what lets the gallery route zip it
  // against socialVideoKeys by index without needing to know which cuts
  // have one. Duration is hit by solving for a per-slot length that lands
  // each cut's sequence near TARGET_SOCIAL_SECONDS, rather than using the
  // full cut's fixed pacing -- note that a roast-captioned slot still
  // overrides this to ROAST_SLOT_SECONDS (lib/video-assemble.js), same
  // trade-off the full video already makes, so a heavily-roasted cut can
  // run past the advertised 60-90s.
  const socialVideoKeys = [];
  const socialVideoNoRoastKeys = [];
  const socialVideoPosterKeys = [];
  const socialVideoNoRoastPosterKeys = [];
  if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier)) {
    // skipFullVideo (all-photos social cuts mode) has no fixed cut count --
    // keep rendering cuts until a prefix comes up empty, rather than
    // stopping at SOCIAL_CUTS_COUNT[tier].
    const cutsForTier = skipFullVideo ? Infinity : (SOCIAL_CUTS_COUNT[tier] || 1);
    for (let cutIndex = 0; cutIndex < cutsForTier; cutIndex++) {
      const socialKeys = await listDeliverableFiles(bookingId, `social-${cutIndex + 1}-photo-`);
      if (socialKeys.length === 0) break; // ran out of photos for a further cut -- stop, don't render empty ones

      console.log(`Assembling social cut ${cutIndex + 1} from ${socialKeys.length} photo(s)...`);
      const socialLocalPaths = [];
      const socialBuffers = [];
      for (const key of socialKeys) {
        const buffer = await downloadFromR2(key);
        const localPath = path.join(tmpDir, path.basename(key));
        fs.writeFileSync(localPath, buffer);
        socialLocalPaths.push(localPath);
        socialBuffers.push(buffer);
      }

      let cutRoastLines = null;
      if (roastEnabled) {
        console.log(`Roast Reel add-on enabled -- generating script for social cut ${cutIndex + 1}...`);
        const roastPhotos = socialBuffers.map((buffer, i) => ({ buffer, storageKey: socialKeys[i] }));
        const recentLines = await fetchRecentRoastLines();
        const script = await generateRoastScript(roastPhotos, { eventType, roastLevel: roastLevel || "light", recentLines });
        cutRoastLines = script.map((line) => line.line);
        await saveRoastLines(bookingId, eventType, roastLevel || "light", cutRoastLines);
      }

      // Closing card, same as the full video's -- appended after this cut's
      // real photos, counted as one more slot in the TARGET_SOCIAL_SECONDS
      // solve below rather than pushing the cut past its target.
      const socialOutroBackground = await buildOutroBackground(fs.readFileSync(socialLocalPaths[socialLocalPaths.length - 1]));
      const socialOutroPath = path.join(tmpDir, `social-cut-${cutIndex + 1}-outro.jpg`);
      fs.writeFileSync(socialOutroPath, socialOutroBackground);
      const socialLocalPathsWithOutro = [...socialLocalPaths, socialOutroPath];

      // Solve for the per-slot duration that lands the whole crossfaded
      // sequence at TARGET_SOCIAL_SECONDS: total = n*d - (n-1)*transition,
      // so d = (target + (n-1)*transition) / n. Must use this style's
      // actual transitionSeconds (socialStyleConfig, computed above from
      // socialStyle || style, matching STYLE_MUSIC's own fallback) rather
      // than a hardcoded value -- using the wrong number here would land
      // the rendered cut's real length off of TARGET_SOCIAL_SECONDS, since
      // assembleSlideshow below renders with that same transitionSeconds.
      const slotSeconds = (TARGET_SOCIAL_SECONDS + (socialLocalPathsWithOutro.length - 1) * socialStyleConfig.transitionSeconds) / socialLocalPathsWithOutro.length;
      const cutOverlayLines = [...buildOverlayLines(effectiveSocialStyle, socialSelections[cutIndex] || [], eventType), { text: outroOverlayText(hostName, eventType), position: "center", fontColor: "white", boxColor: "black@0.45" }];
      const socialVideoLocalPath = path.join(tmpDir, `social-cut-${cutIndex + 1}.mp4`);
      await assembleSlideshow(socialLocalPathsWithOutro, [], socialVideoLocalPath, socialMusicPath, cutRoastLines, slotSeconds, { ...socialStyleConfig, overlayLines: cutOverlayLines });
      const socialVideoBuffer = fs.readFileSync(socialVideoLocalPath);
      const socialVideoKey = `deliverable/${bookingId}/social-cut-${cutIndex + 1}.mp4`;
      await uploadToR2(socialVideoKey, socialVideoBuffer, "video/mp4");
      socialVideoKeys.push(socialVideoKey);
      socialVideoPosterKeys.push(await uploadPosterFor(socialVideoLocalPath, tmpDir, `deliverable/${bookingId}/social-cut-${cutIndex + 1}-poster.jpg`));

      if (cutRoastLines) {
        console.log(`Roast Reel enabled -- also assembling a caption-free version of social cut ${cutIndex + 1}...`);
        const noRoastLocalPath = path.join(tmpDir, `social-cut-${cutIndex + 1}-no-roast.mp4`);
        await assembleSlideshow(socialLocalPathsWithOutro, [], noRoastLocalPath, socialMusicPath, null, slotSeconds, { ...socialStyleConfig, overlayLines: cutOverlayLines });
        const noRoastBuffer = fs.readFileSync(noRoastLocalPath);
        const noRoastKey = `deliverable/${bookingId}/social-cut-${cutIndex + 1}-no-roast.mp4`;
        await uploadToR2(noRoastKey, noRoastBuffer, "video/mp4");
        socialVideoNoRoastKeys.push(noRoastKey);
        socialVideoNoRoastPosterKeys.push(await uploadPosterFor(noRoastLocalPath, tmpDir, `deliverable/${bookingId}/social-cut-${cutIndex + 1}-no-roast-poster.jpg`));
      }
    }
  }

  console.log("Writing deliverable record...");
  // Upsert on booking_id, not a blind insert -- a manual reprocess of an
  // already-delivered booking (this pipeline is explicitly designed to
  // survive that, see the comments above) would otherwise leave two rows
  // per booking, since booking_id had no uniqueness guard until the
  // deliverables_booking_id_key constraint (migration 017).
  const { error: deliverableError } = await supabase.from("deliverables").upsert(
    {
      booking_id: bookingId,
      full_video_key: videoKey,
      full_video_no_roast_key: noRoastVideoKey,
      full_video_poster_key: videoPosterKey,
      full_video_no_roast_poster_key: noRoastVideoPosterKey,
      // social_video_key (singular) kept in sync with the first cut for
      // anything still reading it (e.g. poll-and-recap.js's purge step);
      // social_video_keys is the real, complete list.
      social_video_key: socialVideoKeys[0] || null,
      social_video_keys: socialVideoKeys,
      social_video_no_roast_keys: socialVideoNoRoastKeys,
      social_video_poster_keys: socialVideoPosterKeys,
      social_video_no_roast_poster_keys: socialVideoNoRoastPosterKeys,
      gallery_photo_keys: enhancedKeys,
      gallery_photo_captions: galleryCaptions,
      delivered_at: new Date().toISOString(),
    },
    { onConflict: "booking_id" }
  );
  // Without this, a failed upsert still falls through to marking the
  // booking "delivered" below with no actual deliverable row -- the
  // gallery page would then show "this gallery's window has ended and
  // everything's been removed" for a booking that was never delivered
  // at all.
  if (deliverableError) throw deliverableError;

  const expiresAt = computeGalleryExpiry(tier);

  // Every tier's finished gallery/video is deleted once its own retention
  // window passes (7 days Free, 2/4/6 months Highlight/Spotlight/Luxe -- see
  // lib/galleryExpiry.js), matching what the Privacy Policy/FAQ promise.
  // See purgeExpiredGalleries() in scripts/poll-and-recap.js, which reads this.
  const galleryPurgeAt = expiresAt.toISOString();

  // Guarded on status still being "editing": the cancel/reschedule routes
  // block themselves once a booking reaches "editing", but only check status
  // at the start of their own request -- a cancellation that lands in the
  // narrow window between that check and their own update could otherwise
  // still race past it, and this unconditional update would then deliver
  // (and email) a booking the host just cancelled and got refunded for.
  const { data: delivered } = await supabase
    .from("bookings")
    .update({ status: "delivered", delivered_at: new Date().toISOString(), gallery_expires_at: expiresAt.toISOString(), gallery_purge_at: galleryPurgeAt })
    .eq("id", bookingId)
    .eq("status", "editing")
    .select("id")
    .maybeSingle();

  if (!delivered) {
    console.log(`Booking ${bookingId} is no longer "editing" (cancelled mid-run?) -- skipping delivery email and upload purge scheduling.`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  // Raw guest uploads get permanently deleted 30 days from here -- see
  // purgeExpiredUploads() in scripts/poll-and-recap.js, which reads this.
  const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("uploads").update({ purge_at: purgeAt }).eq("booking_id", bookingId);

  // Same reasoning as the roast approval email: the deliverable and the
  // "delivered" status are already saved at this point, so a missing
  // RESEND_API_KEY/APP_URL should be a warning, not a crash.
  try {
    const { sendDeliveryNotification } = require("../lib/email");
    await sendDeliveryNotification({
      to: hostEmail,
      hostName,
      galleryUrl: `${process.env.APP_URL}/gallery/${bookingId}`,
      expiresDate: expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });
  } catch (err) {
    console.error(`Delivery email failed (booking is still marked delivered): ${err.message}`);
    captureError(err, { tags: { script: "auto-recap", email: "delivery-notification" }, extra: { bookingId } });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`Done. Booking ${bookingId} marked delivered with ${enhancedKeys.length} photos${skipFullVideo ? "" : ", a full-cut video,"} and ${socialVideoKeys.length} social cut(s).`);
}

if (require.main === module) {
  const [arg1, arg2] = process.argv.slice(2);
  const isSubcommand = arg1 === "submit" || arg1 === "resume";
  const bookingId = isSubcommand ? arg2 : arg1;

  if (!bookingId) {
    console.log("Usage: node scripts/auto-recap.js <bookingId>");
    console.log("       node scripts/auto-recap.js submit <bookingId>  (submit the analysis batch only)");
    console.log("       node scripts/auto-recap.js resume <bookingId>  (check/continue after a submitted batch)");
    process.exit(1);
  }

  const run = arg1 === "submit" ? runSubmitOnly : arg1 === "resume" ? runResumeOnly : runAutoRecap;

  run(bookingId)
    .then(
      () => 0,
      (err) => {
        console.error("Pipeline failed:", err);
        captureError(err, { tags: { script: "auto-recap", step: isSubcommand ? arg1 : "run-auto-recap" }, extra: { bookingId } });
        return 1;
      }
    )
    // Runs after either branch above, always before exit -- this process
    // exits right after this resolves (a GitHub Actions job step, not a
    // long-lived server), so this is the last chance for a captureError()
    // call above to actually finish sending.
    .then((exitCode) => flushSentry().then(() => process.exit(exitCode)));
}

module.exports = { runAutoRecap, runSubmitOnly, runResumeOnly };
