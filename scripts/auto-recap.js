/**
 * Recapped For You â€” Fully Automated Recap Pipeline
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
const { assembleSlideshow, extractPosterFrame, planChunks, renderFullVideoChunks, mergeFullVideoChunks } = require("../lib/video-assemble");
const { generateRoastScript } = require("../lib/roast");
const { buildCardBackground } = require("../lib/card-background");
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

// Royalty-free tracks (Pixabay Content License â€” free for commercial use,
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

// Falls back to cinematic, not documentary -- see the same reasoning in
// enhancePhoto's own fallback comment (lib/photo-enhance.js): documentary
// is the least stylized treatment on purpose, which is a poor silent
// default for a host who never expressed a preference.
function styleVideoConfigFor(style) {
  return STYLE_VIDEO_CONFIG[style] || STYLE_VIDEO_CONFIG.cinematic;
}

// Social cuts are made for Reels/TikTok/Shorts, all vertical natively --
// unlike the full video (a different product: downloaded, watched on a TV
// or laptop, attached to an email), a social cut shared as-is at the full
// video's landscape framing shows up pillarboxed on every one of those
// platforms. 1080x1920 is the standard vertical delivery resolution across
// all three. Spread into assembleSlideshow's styleConfig alongside
// socialStyleConfig at both social-cut call sites below -- the full
// video's calls never receive this, so they keep assembleSlideshow's
// landscape defaults untouched.
const SOCIAL_CUT_OUTPUT = { outputWidth: 1080, outputHeight: 1920 };

// Social cuts used to give only the first real photo (imagePaths index 1 --
// index 0 is the intro card) a punch-in zoom (lib/video-assemble.js's
// heroZoomIndex) and leave every other slot a static frame, on the theory
// that a hook right as the intro card hands off matters for social
// retention. Dropped by request in favor of the same continuous kenBurns
// drift the full video gives every photo -- one photo visibly moving
// differently from the rest of the same cut read as inconsistent rather
// than as a deliberate hook.

// Per-photo overlay text is switched off: nothing is burned onto the
// actual photos in either the full video or the social cuts, for any
// style. This used to add Highlight Reel's uppercase moment_type call-outs
// (top-center, one per photo) and Retro's single vintage event-type label
// on the first photo -- both removed by request, on the same reasoning as
// dropping the roast captions from social cuts: a label box on top of the
// photo covers more than it's worth. The intro/outro title CARDS (their
// own dedicated backdrop slots, not photos) keep their text -- see
// introOverlayText/outroOverlayText below, added to the overlayLines
// array separately from this. Returns an all-null array of the caller's
// length, which assembleSlideshow treats as "no overlay".
function buildOverlayLines(entries) {
  return entries.map(() => null);
}

// The closing card's sign-off line -- same for every style (this is a
// universal polish item, not a per-style stylistic choice, unlike
// highlightCallout/the retro title above). Rendered centered on its own
// dedicated backdrop (see buildCardBackground in lib/card-background.js), not
// squeezed onto the last real photo, so it never has to compete with a
// roast line or a style's own overlay for space.
function outroOverlayText(hostName, eventType) {
  return `Thank you for celebrating ${hostName}'s ${eventType}`;
}

// The opening card's title -- matches the gallery page's own eventName
// heading (`${host_name}'s ${event_type}`, app/gallery/[bookingId]/page.jsx)
// so the video and gallery introduce the event the same way.
function introOverlayText(hostName, eventType) {
  return `${hostName}'s ${eventType}`;
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

// Only this top fraction of the shortlist (by emotional_strength +
// technical_quality) gets a Roast Reel line; the rest play captionless at
// the normal pace. A roast-captioned slot runs 2.5x longer (ROAST_SLOT_SECONDS
// in lib/video-assemble.js), so captioning every photo balloons both the
// runtime and the render time of a large booking -- briefly capped to the
// best-scored ~third for exactly that reason, but reverted (1 = all of
// them): picking "Roast Reel" should mean the whole video is roasted, not
// just some of it. Large bookings now lean on resumable rendering (spans
// several scheduled runs) rather than a coverage cap to stay within a job's
// time budget -- see fix/resumable-rendering.
const ROAST_FRACTION = 1;

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
async function uploadPosterFor(videoLocalPath, tmpDir, posterKey, atSeconds = 1.5) {
  const posterLocalPath = path.join(tmpDir, `${path.basename(videoLocalPath, ".mp4")}-poster.jpg`);
  await extractPosterFrame(videoLocalPath, posterLocalPath, atSeconds);
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
  console.log(`  âš  ${upload.storage_key}${label} â€” flagged (${analysis.flag_reason || "inappropriate content"}), removing`);
  try {
    await deleteFromR2(upload.storage_key);
  } catch (err) {
    console.error(`    failed to delete ${upload.storage_key} from R2: ${err.message}`);
  }
  await supabase.from("uploads").delete().eq("id", upload.id);
}

async function recordAnalysisFailure(bookingId, upload, errorMessage) {
  console.error(`  âœ— ${upload.storage_key} â€” analysis failed: ${errorMessage}`);
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
      console.log(`  âœ“ ${upload.storage_key} â€” quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}`);
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
      console.error(`  âœ— ${upload.storage_key} â€” no batch result found, skipping`);
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
      console.log(`  âœ“ ${upload.storage_key} â€” quality ${result.analysis.technical_quality}, emotion ${result.analysis.emotional_strength}`);
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

  // render_lock_at is claimed here (not just in poll-and-recap.js's
  // continue-render loop) so a concurrent poll run can't start a second
  // render on this booking while this first pass is still going. Released in
  // continuePipelineWithAnalysis once the first driveRender pass returns.
  await supabase
    .from("bookings")
    .update({ status: "editing", processing_started_at: new Date().toISOString(), batch_id: null, render_lock_at: new Date().toISOString() })
    .eq("id", bookingId);
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
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null, batch_id: null, render_lock_at: null }).eq("id", bookingId).eq("status", "analyzing");
    // Only reached for a failure between the analyzing->editing flip and the
    // render_state upsert (enhancement/roast/card-upload) -- startRender
    // swallows driveRender errors past that point so the booking stays
    // "editing" to resume. render_lock_at (claimed at the flip) is cleared
    // here too.
    await supabase.from("bookings").update({ status: "collecting", processing_started_at: null, render_lock_at: null }).eq("id", bookingId).eq("status", "editing");
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

// Operator tool: re-render ONLY the full recap video for a booking that's
// already been delivered, on the current rendering code, without disturbing
// anything else about the delivery. Rebuilds the exact same analysis from
// the original photo-analysis batch (so buildShortlist picks the same
// photos in the same order), then runs the pipeline's back half in
// fullVideoOnly mode -- see continuePipelineWithAnalysis. The batch id is
// required and explicit rather than looked up, because a delivered
// booking's batch_id has already been cleared. Not wrapped in
// withStatusRevertOnFailure: the booking stays "delivered" throughout, and
// a failure just leaves the previous full video in place.
async function regenerateFullVideo(bookingId, batchId, hostContext) {
  if (!batchId) {
    throw new Error("full-video needs the analysis batch id: node scripts/auto-recap.js full-video <bookingId> <batchId> [\"host context...\"]");
  }
  const { data: booking, error } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (error || !booking) throw new Error("Booking not found");
  if (booking.status !== "delivered") {
    throw new Error(
      `Booking ${bookingId} is "${booking.status}", not "delivered" -- full-video re-render is only for an already-delivered booking. Use the normal pipeline for one that hasn't shipped yet.`
    );
  }
  const batch = await getBatch(batchId);
  if (batch.processing_status !== "ended") {
    throw new Error(`Analysis batch ${batchId} is "${batch.processing_status}", not "ended"`);
  }
  console.log(`Rebuilding analysis for booking ${bookingId} from batch ${batchId}...`);
  if (hostContext) console.log(`Using host context for the roast: ${hostContext}`);
  const analyzed = await buildAnalyzedFromBatchResults(bookingId, batch.results_url);
  if (analyzed.length === 0) throw new Error(`No usable analyzed photos from batch ${batchId}`);
  await continuePipelineWithAnalysis(booking, analyzed, { fullVideoOnly: true, hostContext });
}

// The back half of the pipeline -- everything that happens once a photo's
// analysis is known, regardless of whether it came from a finished batch
// or the synchronous fallback. Unchanged in behavior from before the Batch
// API was wired in; only the analysis step above it changed.
// fullVideoOnly: re-render just the full recap video for a booking that has
// ALREADY been delivered, reusing the exact same analysis (so the same
// shortlist, in the same order) but the current rendering code. It enhances
// only the shortlisted photos, in memory, and -- via finalizeDelivery --
// overwrites only full-cut.mp4 / full-cut-no-roast.mp4 and their posters.
// The gallery photos, every social cut, the booking status, and the
// delivery email are all left exactly as the original delivery left them.
async function continuePipelineWithAnalysis(booking, analyzed, { fullVideoOnly = false, hostContext } = {}) {
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
  const enhancedKeys = [];
  const enhancedByUploadId = new Map();
  const enhancedKeyByUploadId = new Map();

  if (fullVideoOnly) {
    // Only the shortlisted photos are needed, and only in memory -- no R2
    // writes, so the gallery's own deliverable/<id>/photo-N.jpg files stay
    // untouched.
    console.log(`Full-video re-render -- enhancing ${videoShortlist.length} shortlisted photo(s)...`);
    for (const { buffer, upload } of videoShortlist) {
      enhancedByUploadId.set(upload.id, await enhancePhoto(buffer, booking.style));
    }
  } else {
    console.log("Auto-enhancing all uploaded photos for the gallery...");
    const gallerySelection = buildGallerySelection(analyzed, SHORTLIST_CAP[booking.tier] || Infinity);
    for (let i = 0; i < gallerySelection.length; i++) {
      const { buffer, upload } = gallerySelection[i];
      const enhanced = await enhancePhoto(buffer, booking.style);
      const key = `deliverable/${bookingId}/photo-${i + 1}.jpg`;
      await uploadToR2(key, enhanced, "image/jpeg");
      enhancedKeys.push(key);
      enhancedByUploadId.set(upload.id, enhanced);
      enhancedKeyByUploadId.set(upload.id, key);
    }
  }

  const localPaths = [];
  // R2 key per shortlist photo, in shortlist order -- the render spec's
  // slotKeys. For a normal delivery these are the gallery's own
  // deliverable/<id>/photo-N.jpg (already uploaded above). For a
  // full-video-only re-render the gallery photos exist but in gallery order,
  // so the enhanced shortlist is parked under _render/ instead (cleaned up
  // when the render finishes).
  const videoStorageKeys = [];
  for (let i = 0; i < videoShortlist.length; i++) {
    const { upload } = videoShortlist[i];
    const enhanced = enhancedByUploadId.get(upload.id);
    const localPath = path.join(tmpDir, `video-photo-${i + 1}.jpg`);
    fs.writeFileSync(localPath, enhanced);
    localPaths.push(localPath);
    if (fullVideoOnly) {
      const k = `deliverable/${bookingId}/_render/photo-${i + 1}.jpg`;
      await uploadToR2(k, enhanced, "image/jpeg");
      videoStorageKeys.push(k);
    } else {
      videoStorageKeys.push(enhancedKeyByUploadId.get(upload.id));
    }
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
  if (!fullVideoOnly && SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier) && booking.delivery_format !== "video_only") {
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
  // is skipped there even if roast_enabled is set. Every intensity level's
  // prompt (lib/roast.js) carries a hard rule to roast the moment, never a
  // person's body/appearance/race, so the script needs no separate host
  // review before it's used.
  //
  // hostContext (an explicit override on a re-render, otherwise the
  // booking's own notes) is passed as ground-truth facts -- names, who's
  // who, relationships -- so the model doesn't have to guess at, e.g.,
  // whether two people are sisters or friends (it's told not to guess).
  let roastLines = null;
  if (booking.roast_enabled && !useAllPhotoSocialCuts) {
    // Roast only the best-scored ROAST_FRACTION of the shortlist. roastIdx
    // holds those photos' positions in videoShortlist (kept in ascending
    // order so the lines still map back positionally), scored by the same
    // emotional_strength + technical_quality sum buildShortlist ranks on.
    const scoreOf = (e) => (e.analysis.emotional_strength || 0) + (e.analysis.technical_quality || 0);
    const roastCount = Math.max(1, Math.ceil(videoShortlist.length * ROAST_FRACTION));
    const roastIdx = videoShortlist
      .map((e, i) => ({ i, s: scoreOf(e) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, roastCount)
      .map((x) => x.i)
      .sort((a, b) => a - b);
    console.log(`Roast Reel add-on enabled -- generating lines for the top ${roastIdx.length} of ${videoShortlist.length} shortlisted photos...`);
    const roastPhotos = roastIdx.map((i) => ({ buffer: fs.readFileSync(localPaths[i]), storageKey: videoStorageKeys[i] }));
    const recentLines = await fetchRecentRoastLines();
    const script = await generateRoastScript(roastPhotos, {
      eventType: booking.event_type,
      roastLevel: booking.roast_level || "light",
      recentLines,
      hostContext: hostContext || booking.notes || undefined,
    });
    // Scatter the k generated lines back onto a full-shortlist-length array;
    // every non-roasted slot stays null, which assembleSlideshow already
    // treats as "no caption, normal duration". script entries are validated
    // as a 0..k-1 permutation, so photo_index indexes roastIdx directly.
    roastLines = new Array(videoShortlist.length).fill(null);
    for (const entry of script) roastLines[roastIdx[entry.photo_index]] = entry.line;
    await saveRoastLines(bookingId, booking.event_type, booking.roast_level || "light", roastLines.filter(Boolean));
  }

  // Hand off to the resumable renderer: build the render spec (everything a
  // later scheduled run needs with nothing left in memory) and kick off the
  // first pass. See startRender / driveRender below.
  const styleConfigForVideo = styleVideoConfigFor(booking.style);
  const socialCutCount =
    !SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier) || booking.delivery_format === "video_only"
      ? 0
      : useAllPhotoSocialCuts
      ? Infinity
      : SOCIAL_CUTS_COUNT[booking.tier] || 1;

  let spec;
  if (useAllPhotoSocialCuts) {
    // "Social cuts of every photo" -- no full recap video at all.
    spec = {
      skipFullVideo: true,
      slotKeys: [],
      roastLines: null,
      style: booking.style,
      socialStyle: booking.social_style,
      tier: booking.tier,
      noMusic: booking.full_video_no_music,
      socialNoMusic: booking.social_style === "none",
      hostName: booking.host_name,
      hostEmail: booking.email,
      eventType: booking.event_type,
      galleryPhotoKeys: enhancedKeys,
      socialCutCount,
    };
  } else {
    const { introKey, outroKey } = await buildAndUploadCards(
      bookingId,
      fs.readFileSync(localPaths[0]),
      fs.readFileSync(localPaths[localPaths.length - 1])
    );
    const slotKeys = [introKey, ...videoStorageKeys, outroKey];
    // Free's highlight video targets a total duration; every other tier uses
    // fixed per-photo pacing. Same solve as the social cut. Cards count as
    // slots so they don't push the video past its target.
    const fullCutTarget = FULL_CUT_TARGET_SECONDS[booking.tier];
    const fullCutSlotSeconds = fullCutTarget
      ? (fullCutTarget + (slotKeys.length - 1) * styleConfigForVideo.transitionSeconds) / slotKeys.length
      : styleConfigForVideo.slotSeconds;
    spec = {
      slotKeys,
      // Parallel to slotKeys: a leading null for the intro card, a trailing
      // null for the outro card, roastLines (already sparse, ~35% filled) in
      // between -- matches the old shiftedRoastLines shift.
      roastLines: roastLines ? [null, ...roastLines, null] : null,
      style: booking.style,
      socialStyle: booking.social_style,
      tier: booking.tier,
      fullCutSlotSeconds,
      noMusic: booking.full_video_no_music,
      socialNoMusic: booking.social_style === "none",
      hostName: booking.host_name,
      hostEmail: booking.email,
      eventType: booking.event_type,
      galleryPhotoKeys: enhancedKeys,
      socialCutCount,
    };
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  currentTmpDir = null;
  await startRender(bookingId, spec, {
    finalize: fullVideoOnly ? "video-only" : "full",
    // A manual full-video re-render has no job clock; a scheduled first
    // delivery run has already spent time on analysis + enhancement +
    // roast, so it gets a reduced first slice and continuation runs pick up
    // the rest.
    budgetMs: fullVideoOnly ? Infinity : FIRST_RENDER_BUDGET_MS,
  });
  // Release the render lock claimed at the analyzing->editing flip (or, for a
  // full-video re-render, never claimed -- this is a harmless no-op then).
  // If the render finished, status is "delivered" and this matches nothing.
  await supabase.from("bookings").update({ render_lock_at: null }).eq("id", bookingId).eq("status", "editing");
}

const RENDER_BUDGET_MS = 35 * 60 * 1000; // per continuation run
const FIRST_RENDER_BUDGET_MS = 20 * 60 * 1000; // run 1 already spent time on analysis/enhance/roast

// Builds and R2-parks the intro/outro title cards (from the first and last
// shortlisted photo) so a resume run can fetch them like any other slot.
async function buildAndUploadCards(bookingId, firstPhotoBuffer, lastPhotoBuffer) {
  const introKey = `deliverable/${bookingId}/_render/intro-card.jpg`;
  const outroKey = `deliverable/${bookingId}/_render/outro-card.jpg`;
  await uploadToR2(introKey, await buildCardBackground(firstPhotoBuffer), "image/jpeg");
  await uploadToR2(outroKey, await buildCardBackground(lastPhotoBuffer), "image/jpeg");
  return { introKey, outroKey };
}

async function persistRenderState(bookingId, renderState) {
  renderState.updated_at = new Date().toISOString();
  const { error } = await supabase.from("deliverables").update({ render_state: renderState }).eq("booking_id", bookingId);
  if (error) throw error;
}

// Writes the initial render_state and runs the first driveRender pass.
// finalize: "full" = normal delivery (full cut[s] + social cuts + deliverable
// row + status + email); "video-only" = re-render just the full cut of an
// already-delivered booking, overwriting only its full_video_* keys.
async function startRender(bookingId, spec, { finalize, budgetMs = RENDER_BUDGET_MS }) {
  const hasRoast = Array.isArray(spec.roastLines) && spec.roastLines.some(Boolean);
  const totalChunks = spec.skipFullVideo ? 0 : planChunks(spec.slotKeys.length, 0).length;

  const renderState = {
    v: 1,
    finalize,
    phase: spec.skipFullVideo ? "social" : "full",
    updated_at: new Date().toISOString(),
    spec,
    full: spec.skipFullVideo
      ? null
      : {
          main: { totalChunks, done: [], merged: false },
          noRoast: hasRoast ? { totalChunks, done: [], merged: false } : null,
        },
    social: { done: 0, total: spec.socialCutCount === Infinity ? null : spec.socialCutCount },
  };

  // A deliverable row must exist for persistRenderState's .update() to land.
  // "full" first delivery: created here, partial -- the gallery route treats
  // a row with render_state set and no delivered_at as not-ready.
  // "video-only": the row already exists from the prior delivery.
  const { error: upsertErr } = await supabase
    .from("deliverables")
    .upsert(
      { booking_id: bookingId, render_state: renderState, ...(finalize === "full" ? { gallery_photo_keys: spec.galleryPhotoKeys } : {}) },
      { onConflict: "booking_id" }
    );
  // Checked, not swallowed: an unchecked failure here (confirmed live --
  // e.g. the render_state/render_lock_at columns not existing yet because
  // migrations 030/031 hadn't been run) used to silently no-op the entire
  // render instead of surfacing anything -- driveRender's own read-back
  // would then also fail the same way, log "no active render to continue",
  // and return having done nothing, with no error anywhere.
  if (upsertErr) throw new Error(`Failed to write initial render_state for booking ${bookingId}: ${upsertErr.message}`);

  // For a "full" delivery, past this point render_state is the checkpoint: a
  // failure in the first driveRender pass must NOT bubble up to
  // withStatusRevertOnFailure (which wraps resumeAnalysis) -- reverting the
  // booking to "collecting" would discard the render plan and orphan
  // whatever chunks already reached R2, forcing a full re-analyze/enhance.
  // Leave it "editing"; poll-and-recap.js's continue-render phase resumes it
  // next run. (A failure BEFORE this upsert still reverts, which is correct.)
  // A "video-only" re-render has no scheduler to resume it -- let it throw so
  // the operator running `full-video` sees a real failure.
  if (finalize === "video-only") {
    await driveRender(bookingId, { budgetMs });
    return;
  }
  try {
    await driveRender(bookingId, { budgetMs });
  } catch (err) {
    console.error(`Booking ${bookingId}: first render pass failed -- staying "editing" to resume next run: ${err.message}`);
    captureError(err, { tags: { script: "auto-recap", step: "start-render" }, extra: { bookingId } });
  }
}

// Called by poll-and-recap.js's continue-render phase, once per tick, for
// every "editing" booking whose render_state isn't "done" yet. budgetMs is
// the wall-clock slice this run gets (poll-and-recap.js shrinks it so the
// whole render phase stays within one CI job). A throw here is caught by
// processRenderingBookings and the booking just resumes next tick.
async function continueRender(bookingId, budgetMs = RENDER_BUDGET_MS) {
  await driveRender(bookingId, { budgetMs });
}

// Advances a booking's render as far as budgetMs of wall time allows,
// persisting render_state after every chunk, social cut, and phase change.
// Re-entrant: it resumes from render_state.phase and the per-unit done sets,
// so a job killed mid-render loses at most the chunk in flight.
async function driveRender(bookingId, { budgetMs }) {
  const { data: row, error: readErr } = await supabase.from("deliverables").select("render_state").eq("booking_id", bookingId).maybeSingle();
  // Checked, not swallowed -- see the matching comment on startRender's
  // upsert. Without this, a query failure (wrong/missing column, RLS, a
  // transient error) looked identical to "this render already finished":
  // logged as routine, and the caller (continueRender / poll-and-recap.js)
  // saw a normal return, not a failure to retry.
  if (readErr) throw new Error(`Failed to read render_state for booking ${bookingId}: ${readErr.message}`);
  const rs = row && row.render_state;
  if (!rs || rs.phase === "done") {
    console.log(`Booking ${bookingId}: no active render to continue.`);
    return;
  }
  const spec = rs.spec;
  const deadline = Date.now() + budgetMs;
  const overBudget = () => Date.now() >= deadline;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  currentTmpDir = tmpDir;
  const musicPath = spec.noMusic ? null : STYLE_MUSIC[spec.style] || STYLE_MUSIC.cinematic;

  try {
    if (rs.phase === "full") {
      const slotDir = path.join(tmpDir, "slots");
      fs.mkdirSync(slotDir, { recursive: true });
      const slotPath = (i) => path.join(slotDir, `slot-${String(i).padStart(4, "0")}.jpg`);
      const ensureSlot = async (i) => {
        if (!fs.existsSync(slotPath(i))) fs.writeFileSync(slotPath(i), await downloadFromR2(spec.slotKeys[i]));
      };

      // The only burned-on text on the full video is the two title cards
      // (per-photo callouts were dropped -- see buildOverlayLines). Parallel
      // to slotKeys: card text at the ends, null for every photo between.
      const cardOverlays = [
        { text: introOverlayText(spec.hostName, spec.eventType), position: "center", fontColor: "white", boxColor: "black@0.45" },
        ...Array(Math.max(0, spec.slotKeys.length - 2)).fill(null),
        { text: outroOverlayText(spec.hostName, spec.eventType), position: "center", fontColor: "white", boxColor: "black@0.45" },
      ];

      for (const unitName of ["main", "noRoast"]) {
        const unit = rs.full[unitName];
        if (!unit || unit.merged) continue;

        const plan = planChunks(spec.slotKeys.length, 0);
        const doneSet = new Set(unit.done);
        for (let c = 0; c < plan.length; c++) {
          if (doneSet.has(c)) continue;
          for (let i = plan[c].start; i < plan[c].end; i++) await ensureSlot(i);
        }
        const imagePaths = spec.slotKeys.map((_, i) => slotPath(i));
        const unitDir = path.join(tmpDir, unitName);
        fs.mkdirSync(unitDir, { recursive: true });

        const res = await renderFullVideoChunks(imagePaths, [], unitName === "main" ? spec.roastLines : null, cardOverlays, unitDir, {
          baseSlotSeconds: spec.fullCutSlotSeconds,
          styleConfig: { ...styleVideoConfigFor(spec.style), kenBurns: true, photoBackground: "polaroid" },
          doneChunks: doneSet,
          budgetMs: deadline - Date.now(),
          onChunkRendered: async (idx, chunkPath) => {
            await uploadToR2(`deliverable/${bookingId}/_render/${unitName}-chunk-${idx}.mp4`, fs.readFileSync(chunkPath), "video/mp4");
            unit.done = [...new Set([...unit.done, idx])].sort((a, b) => a - b);
            await persistRenderState(bookingId, rs);
          },
        });

        if (!res.complete) {
          console.log(`Booking ${bookingId}: ${unitName} cut at ${unit.done.length}/${unit.totalChunks} chunks, out of time -- continuing next run.`);
          return;
        }

        const mergeDir = path.join(tmpDir, `${unitName}-merge`);
        fs.mkdirSync(mergeDir, { recursive: true });
        const chunkPaths = [];
        for (let i = 0; i < plan.length; i++) {
          const cp = path.join(mergeDir, `chunk-${i}.mp4`);
          fs.writeFileSync(cp, await downloadFromR2(`deliverable/${bookingId}/_render/${unitName}-chunk-${i}.mp4`));
          chunkPaths.push(cp);
        }
        const isMain = unitName === "main";
        const finalKey = `deliverable/${bookingId}/${isMain ? "full-cut.mp4" : "full-cut-no-roast.mp4"}`;
        const posterKey = `deliverable/${bookingId}/${isMain ? "full-cut-poster.jpg" : "full-cut-no-roast-poster.jpg"}`;
        const mergedPath = path.join(mergeDir, "merged.mp4");
        await mergeFullVideoChunks(chunkPaths, mergedPath, musicPath);
        await uploadToR2(finalKey, fs.readFileSync(mergedPath), "video/mp4");
        // uploadPosterFor's own default (1.5s) lands inside the intro card
        // itself -- was spec.fullCutSlotSeconds + 1.5 to skip past the card
        // onto a real photo instead, but that made the gallery's static
        // poster and the video's actual opening frame two different things:
        // reported live as the recap "showing the first picture before the
        // host intro message" when played. Landing the poster ON the card
        // matches what actually plays first.
        await uploadPosterFor(mergedPath, mergeDir, posterKey);
        unit.merged = true;
        unit.finalKey = finalKey;
        unit.posterKey = posterKey;
        await persistRenderState(bookingId, rs);
        for (let i = 0; i < plan.length; i++) {
          await deleteFromR2(`deliverable/${bookingId}/_render/${unitName}-chunk-${i}.mp4`).catch(() => {});
        }
      }

      rs.phase = rs.finalize === "video-only" ? "finalize" : "social";
      await persistRenderState(bookingId, rs);
      if (overBudget()) return;
    }

    if (rs.phase === "social") {
      let renderedThisRun = 0;
      for (let cutIndex = rs.social.done; ; cutIndex++) {
        if (spec.socialCutCount !== Infinity && cutIndex >= spec.socialCutCount) break;
        if (renderedThisRun > 0 && overBudget()) return;
        const socialKeys = await listDeliverableFiles(bookingId, `social-${cutIndex + 1}-photo-`);
        if (socialKeys.length === 0) {
          rs.social.total = cutIndex;
          break;
        }
        await renderOneSocialCut(bookingId, cutIndex, socialKeys, spec, tmpDir);
        renderedThisRun++;
        rs.social.done = cutIndex + 1;
        await persistRenderState(bookingId, rs);
      }
      rs.phase = "finalize";
      await persistRenderState(bookingId, rs);
      if (overBudget()) return;
    }

    if (rs.phase === "finalize") {
      if (rs.finalize === "video-only") {
        const noRoast = rs.full.noRoast;
        await supabase
          .from("deliverables")
          .update({
            full_video_key: rs.full.main.finalKey,
            full_video_no_roast_key: noRoast ? noRoast.finalKey : null,
            full_video_poster_key: rs.full.main.posterKey,
            full_video_no_roast_poster_key: noRoast ? noRoast.posterKey : null,
            render_state: null,
          })
          .eq("booking_id", bookingId);
        console.log(`Booking ${bookingId}: full video re-rendered; social cuts, gallery, status and email untouched.`);
      } else {
        await finalizeFullDelivery(bookingId, rs);
      }
      await cleanupRenderArtifacts(bookingId);
      rs.phase = "done";
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    currentTmpDir = null;
  }
}

// One social cut, rendered whole (they're small -- vertical 1080, <=15
// slots) and checkpointed by the caller after it lands in R2. Caption-free,
// always (see the buildOverlayLines comment).
async function renderOneSocialCut(bookingId, cutIndex, socialKeys, spec, tmpDir) {
  const socialStyleConfig = styleVideoConfigFor(spec.socialStyle || spec.style);
  console.log(`Assembling social cut ${cutIndex + 1} from ${socialKeys.length} photo(s)...`);
  const socialLocalPaths = [];
  for (const key of socialKeys) {
    const lp = path.join(tmpDir, path.basename(key));
    fs.writeFileSync(lp, await downloadFromR2(key));
    socialLocalPaths.push(lp);
  }
  // Same blurred backdrop for both bookends so a looped replay lands on a
  // matching frame (see the original comment).
  const cardBg = await buildCardBackground(fs.readFileSync(socialLocalPaths[0]));
  const introPath = path.join(tmpDir, `social-cut-${cutIndex + 1}-intro.jpg`);
  const outroPath = path.join(tmpDir, `social-cut-${cutIndex + 1}-outro.jpg`);
  fs.writeFileSync(introPath, cardBg);
  fs.writeFileSync(outroPath, cardBg);
  const withCards = [introPath, ...socialLocalPaths, outroPath];
  const slotSeconds = (TARGET_SOCIAL_SECONDS + (withCards.length - 1) * socialStyleConfig.transitionSeconds) / withCards.length;
  const cutOverlayLines = [
    { text: introOverlayText(spec.hostName, spec.eventType), position: "center", fontColor: "white", boxColor: "black@0.45" },
    ...buildOverlayLines(socialLocalPaths),
    { text: outroOverlayText(spec.hostName, spec.eventType), position: "center", fontColor: "white", boxColor: "black@0.45" },
  ];
  const outPath = path.join(tmpDir, `social-cut-${cutIndex + 1}.mp4`);
  const socialMusicPath = spec.socialNoMusic ? null : STYLE_MUSIC[spec.socialStyle || spec.style] || STYLE_MUSIC.cinematic;
  await assembleSlideshow(withCards, [], outPath, socialMusicPath, null, slotSeconds, {
    ...socialStyleConfig,
    ...SOCIAL_CUT_OUTPUT,
    overlayLines: cutOverlayLines,
    kenBurns: true,
  });
  await uploadToR2(`deliverable/${bookingId}/social-cut-${cutIndex + 1}.mp4`, fs.readFileSync(outPath), "video/mp4");
  // Default (1.5s) lands inside the intro card -- see the full-video
  // uploadPosterFor call above for why this used to skip past it.
  await uploadPosterFor(outPath, tmpDir, `deliverable/${bookingId}/social-cut-${cutIndex + 1}-poster.jpg`);
}

// The deliverable row + status flip + delivery email, once every video for a
// "full" render is in R2. Split out of driveRender's finalize phase; mirrors
// what the old inline finalizeDelivery tail did.
async function finalizeFullDelivery(bookingId, rs) {
  const spec = rs.spec;
  const socialVideoKeys = [];
  const socialVideoPosterKeys = [];
  for (let i = 1; i <= rs.social.done; i++) {
    socialVideoKeys.push(`deliverable/${bookingId}/social-cut-${i}.mp4`);
    socialVideoPosterKeys.push(`deliverable/${bookingId}/social-cut-${i}-poster.jpg`);
  }
  const noRoast = rs.full && rs.full.noRoast;

  const { error: deliverableError } = await supabase.from("deliverables").upsert(
    {
      booking_id: bookingId,
      full_video_key: rs.full ? rs.full.main.finalKey : null,
      full_video_no_roast_key: noRoast ? noRoast.finalKey : null,
      full_video_poster_key: rs.full ? rs.full.main.posterKey : null,
      full_video_no_roast_poster_key: noRoast ? noRoast.posterKey : null,
      // social_video_key (singular) kept in sync with the first cut for
      // anything still reading it (poll-and-recap.js's purge step).
      social_video_key: socialVideoKeys[0] || null,
      social_video_keys: socialVideoKeys,
      social_video_no_roast_keys: [],
      social_video_poster_keys: socialVideoPosterKeys,
      social_video_no_roast_poster_keys: [],
      gallery_photo_keys: spec.galleryPhotoKeys,
      delivered_at: new Date().toISOString(),
      render_state: null,
    },
    { onConflict: "booking_id" }
  );
  if (deliverableError) throw deliverableError;

  const expiresAt = computeGalleryExpiry(spec.tier);
  // Guarded on status still being "editing" -- see the original comment: a
  // cancellation racing this update must win.
  const { data: delivered } = await supabase
    .from("bookings")
    .update({ status: "delivered", delivered_at: new Date().toISOString(), gallery_expires_at: expiresAt.toISOString(), gallery_purge_at: expiresAt.toISOString() })
    .eq("id", bookingId)
    .eq("status", "editing")
    .select("id")
    .maybeSingle();

  if (!delivered) {
    console.log(`Booking ${bookingId} is no longer "editing" (cancelled mid-render?) -- skipping delivery email + purge scheduling.`);
    return;
  }

  await supabase
    .from("uploads")
    .update({ purge_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("booking_id", bookingId);

  try {
    const { sendDeliveryNotification } = require("../lib/email");
    await sendDeliveryNotification({
      to: spec.hostEmail,
      hostName: spec.hostName,
      galleryUrl: `${process.env.APP_URL}/gallery/${bookingId}`,
      expiresDate: expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });
  } catch (err) {
    console.error(`Delivery email failed (booking is still marked delivered): ${err.message}`);
    captureError(err, { tags: { script: "auto-recap", email: "delivery-notification" }, extra: { bookingId } });
  }

  console.log(`Done. Booking ${bookingId} delivered: full cut + ${rs.social.done} social cut(s).`);
}

// Removes the _render/ scratch prefix (parked title cards, and any chunk
// files a failed merge left behind) once a render reaches "done".
async function cleanupRenderArtifacts(bookingId) {
  const stragglers = await listDeliverableFiles(bookingId, "_render/");
  for (const key of stragglers) await deleteFromR2(key).catch(() => {});
}

if (require.main === module) {
  const [arg1, arg2, arg3, ...rest] = process.argv.slice(2);
  const isSubcommand = arg1 === "submit" || arg1 === "resume" || arg1 === "full-video" || arg1 === "continue-render";
  const bookingId = isSubcommand ? arg2 : arg1;
  // For `full-video`: everything after <batchId> is the optional host-context
  // string for the roast -- quote it as one arg, or leave it unquoted and the
  // words get joined back together.
  const fullVideoHostContext = rest.length ? rest.join(" ") : undefined;

  if (!bookingId) {
    console.log("Usage: node scripts/auto-recap.js <bookingId>");
    console.log("       node scripts/auto-recap.js submit <bookingId>                          (submit the analysis batch only)");
    console.log("       node scripts/auto-recap.js resume <bookingId>                          (check/continue after a submitted batch)");
    console.log('       node scripts/auto-recap.js full-video <bookingId> <batchId> ["context"]  (re-render only the full video of a delivered booking)');
    console.log("       node scripts/auto-recap.js continue-render <bookingId> [budgetMs]        (advance a render in progress -- called by the scheduler)");
    process.exit(1);
  }

  const run =
    arg1 === "submit" ? runSubmitOnly
    : arg1 === "resume" ? runResumeOnly
    : arg1 === "full-video" ? (id) => regenerateFullVideo(id, arg3, fullVideoHostContext)
    : arg1 === "continue-render" ? (id) => continueRender(id, arg3 ? Number(arg3) : undefined)
    : runAutoRecap;

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

module.exports = { runAutoRecap, runSubmitOnly, runResumeOnly, regenerateFullVideo, continueRender };
