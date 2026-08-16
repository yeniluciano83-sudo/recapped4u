/**
 * Recapped For You — Fully Automated Recap Pipeline
 * ----------------------------------------------------
 * Given a booking ID, this script does everything end-to-end with no
 * human editing step:
 *
 *   1. Pulls the booking's raw uploads (photos AND video clips) from
 *      Supabase + R2
 *   2. Sends each photo -- and a representative frame from each video clip
 *      -- to Claude for curation (score + shortlist)
 *   3. Auto-enhances the shortlisted photos (color, sharpness, style grade)
 *   4. Assembles an automated slideshow video (Ken Burns + crossfades + a
 *      royalty-free soundtrack matched to the booking's editing style),
 *      with the best guest video clips appended after the photo montage
 *   5. Uploads the finished photos + clips + video to R2 under a
 *      deliverable/ path
 *   6. Writes the `deliverables` row and flips the booking to "delivered"
 *
 * Run: node scripts/auto-recap.js <bookingId>
 */
require("dotenv").config({ path: require("path").join(__dirname,"..",".env.local") });
const fs = require("fs");
const os = require("os");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(require("ffmpeg-static"));
const { createClient } = require("@supabase/supabase-js");
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { enhancePhoto } = require("../lib/photo-enhance");
const { assembleSlideshow } = require("../lib/video-assemble");
const { generateRoastScript } = require("../lib/roast");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Royalty-free tracks (Pixabay License — free for commercial use, no
// attribution required), one per editing style, matching the mood
// described for that style on the booking page.
const STYLE_MUSIC = {
  cinematic: path.join(__dirname, "..", "lib", "music", "cinematic.mp3"),
  upbeat: path.join(__dirname, "..", "lib", "music", "upbeat.mp3"),
  documentary: path.join(__dirname, "..", "lib", "music", "documentary.mp3"),
};

// Video clips get their own, smaller cap -- a handful of the best
// guest-recorded moments, not every clip anyone uploaded, so the final
// video's length and this run's Claude spend both stay bounded.
const MAX_VIDEO_CLIPS = 5;

// Signature's gallery stays downloadable for 4 months and Luxe's for 12,
// instead of the default 90 days. Anything not listed here falls back to
// 90 days.
const GALLERY_EXPIRY_MONTHS = { premium: 4, keepsake: 12 };

function computeGalleryExpiry(tier) {
  const expiresAt = new Date();
  const months = GALLERY_EXPIRY_MONTHS[tier];
  if (months) {
    expiresAt.setMonth(expiresAt.getMonth() + months);
  } else {
    expiresAt.setDate(expiresAt.getDate() + 90);
  }
  return expiresAt;
}

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

// Video clips never go through roast approval (they're never roasted), so
// on resume they're recovered by listing what a prior run already uploaded
// rather than re-analyzing them -- avoids paying for clip analysis twice.
async function listDeliverableClips(bookingId) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `deliverable/${bookingId}/clip-` }));
  return (res.Contents || []).map((o) => o.Key).sort();
}

// Claude's vision input doesn't accept video directly -- pull one
// representative frame so a video clip can be scored with the same
// photo-analysis call as an actual photo. Uses a fixed 1s input-side seek
// (via -ss before -i, not fluent-ffmpeg's .screenshots() helper) because
// this project only bundles ffmpeg-static, not ffprobe -- .screenshots()'s
// percentage-based timestamps require ffprobe to resolve the clip's
// duration first, which isn't available here. A fixed offset needs no
// duration lookup at all. ffmpeg clamps automatically for clips under 1s.
function extractVideoFrame(videoBuffer) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-"));
    const videoPath = path.join(tmpDir, "clip.mp4");
    const framePath = path.join(tmpDir, "frame.jpg");
    fs.writeFileSync(videoPath, videoBuffer);
    ffmpeg(videoPath)
      .inputOptions(["-ss", "1"])
      .outputOptions(["-frames:v", "1", "-vf", "scale=1280:-1"])
      .output(framePath)
      .on("end", () => {
        try {
          const buffer = fs.readFileSync(framePath);
          resolve(buffer);
        } catch (err) {
          reject(err);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      })
      .on("error", (err) => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        reject(err);
      })
      .run();
  });
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

function parseJson(raw) {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

async function analyzePhoto(buffer, mediaType) {
  const prompt = `Analyze this event photo. Respond ONLY with JSON: {"technical_quality": 1-10, "emotional_strength": 1-10, "moment_type": "string", "notes": "short phrase"}`;
  const raw = await callClaude([
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }, { type: "text", text: prompt }] },
  ]);
  return parseJson(raw);
}

async function buildShortlist(analyzed, maxPhotos = 15) {
  return analyzed
    .filter((p) => p.analysis.technical_quality >= 4)
    .sort((a, b) => (b.analysis.emotional_strength + b.analysis.technical_quality) - (a.analysis.emotional_strength + a.analysis.technical_quality))
    .slice(0, maxPhotos);
}

async function runAutoRecap(bookingId) {
  console.log(`Starting automated recap for booking ${bookingId}`);

  const { data: booking, error: bookingErr } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingErr || !booking) throw new Error("Booking not found");

  // A booking paused for Roast Reel approval has already been analyzed and
  // enhanced -- re-running the full pipeline would redo that (wasted Claude
  // spend) and generate a second, conflicting script. Resume at final
  // rendering instead once the host has approved.
  if (booking.status === "awaiting_roast_approval") {
    return finishAfterRoastApproval(booking);
  }

  return runFullPipeline(booking);
}

async function finishAfterRoastApproval(booking) {
  const bookingId = booking.id;

  const { data: roastScript, error } = await supabase
    .from("roast_scripts")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !roastScript) throw new Error("No Roast Reel script found for this booking");

  if (roastScript.status !== "approved") {
    console.log(`Booking ${bookingId} is still awaiting host approval of its Roast Reel script. Nothing to do yet.`);
    return;
  }

  console.log("Roast Reel script approved -- downloading enhanced photos and finishing the video...");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-roast-"));
  const localPaths = [];
  const roastLines = [];

  for (const entry of roastScript.script) {
    const buffer = await downloadFromR2(entry.storage_key);
    const localPath = path.join(tmpDir, path.basename(entry.storage_key));
    fs.writeFileSync(localPath, buffer);
    localPaths.push(localPath);
    roastLines.push(entry.line);
  }

  // Video clips never go through roast approval -- they were already
  // uploaded to R2 earlier in the run that generated this script. Recover
  // them by listing rather than re-analyzing, so resuming doesn't pay for
  // clip analysis twice.
  const clipKeys = await listDeliverableClips(bookingId);
  const clipLocalPaths = [];
  for (const key of clipKeys) {
    const buffer = await downloadFromR2(key);
    const localPath = path.join(tmpDir, path.basename(key));
    fs.writeFileSync(localPath, buffer);
    clipLocalPaths.push(localPath);
  }
  if (clipKeys.length > 0) console.log(`Recovered ${clipKeys.length} previously-uploaded video clip(s).`);

  const enhancedKeys = roastScript.script.map((entry) => entry.storage_key);
  const musicPath = STYLE_MUSIC[booking.style];
  await finalizeDelivery(bookingId, localPaths, clipLocalPaths, enhancedKeys, tmpDir, musicPath, roastLines, booking.email, booking.host_name, booking.tier);
}

async function runFullPipeline(booking) {
  const bookingId = booking.id;

  await supabase.from("bookings").update({ status: "editing" }).eq("id", bookingId);

  const { data: uploads, error: uploadsErr } = await supabase.from("uploads").select("*").eq("booking_id", bookingId);
  if (uploadsErr) throw uploadsErr;
  if (!uploads || uploads.length === 0) throw new Error("No uploads found for this booking");

  const photoUploads = uploads.filter((u) => u.file_type === "photo");
  const videoUploads = uploads.filter((u) => u.file_type === "video");

  console.log(`Found ${photoUploads.length} raw photos and ${videoUploads.length} video clips. Downloading and analyzing...`);

  const analyzed = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-"));

  for (const upload of photoUploads) {
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      const ext = path.extname(upload.storage_key).toLowerCase();
      const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
      const analysis = await analyzePhoto(buffer, mediaType);
      analyzed.push({ upload, buffer, analysis });
      console.log(`  ✓ ${upload.storage_key} — quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}`);
    } catch (err) {
      console.error(`  ✗ ${upload.storage_key} — analysis failed: ${err.message}`);
    }
  }

  const analyzedClips = [];
  for (const upload of videoUploads) {
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      const frameBuffer = await extractVideoFrame(buffer);
      const analysis = await analyzePhoto(frameBuffer, "image/jpeg");
      analyzedClips.push({ upload, buffer, analysis });
      console.log(`  ✓ ${upload.storage_key} (video) — quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}`);
    } catch (err) {
      console.error(`  ✗ ${upload.storage_key} (video) — analysis failed: ${err.message}`);
    }
  }

  const shortlist = await buildShortlist(analyzed);
  const clipShortlist = await buildShortlist(analyzedClips, MAX_VIDEO_CLIPS);
  console.log(`Shortlisted ${shortlist.length} photos and ${clipShortlist.length} video clip(s) for the final cut.`);

  if (shortlist.length === 0 && clipShortlist.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await supabase.from("bookings").update({ status: "collecting" }).eq("id", bookingId);
    throw new Error(
      `No photos or video clips met the quality threshold for booking ${bookingId} -- reverted status to "collecting".`
    );
  }

  console.log("Auto-enhancing shortlisted photos...");
  const enhancedKeys = [];
  const localPaths = [];

  for (let i = 0; i < shortlist.length; i++) {
    const { buffer } = shortlist[i];
    const enhanced = await enhancePhoto(buffer, booking.style);
    const key = `deliverable/${bookingId}/photo-${i + 1}.jpg`;
    await uploadToR2(key, enhanced, "image/jpeg");
    enhancedKeys.push(key);

    const localPath = path.join(tmpDir, `photo-${i + 1}.jpg`);
    fs.writeFileSync(localPath, enhanced);
    localPaths.push(localPath);
  }

  // Video clips don't go through photo-style enhancement (that's sharp's
  // image-only pipeline) -- upload as-is. They're stored now, before the
  // roast-approval pause below, so finishAfterRoastApproval can recover
  // them later via listDeliverableClips without re-downloading/re-analyzing.
  console.log("Uploading shortlisted video clips...");
  const clipLocalPaths = [];
  for (let i = 0; i < clipShortlist.length; i++) {
    const { buffer, upload } = clipShortlist[i];
    const ext = path.extname(upload.storage_key).toLowerCase() || ".mp4";
    const key = `deliverable/${bookingId}/clip-${i + 1}${ext}`;
    await uploadToR2(key, buffer, ext === ".mov" ? "video/quicktime" : "video/mp4");

    const localPath = path.join(tmpDir, `clip-${i + 1}${ext}`);
    fs.writeFileSync(localPath, buffer);
    clipLocalPaths.push(localPath);
  }

  if (booking.roast_enabled) {
    console.log("Roast Reel add-on enabled -- generating script for host approval...");
    const roastPhotos = localPaths.map((p, i) => ({ buffer: fs.readFileSync(p), storageKey: enhancedKeys[i] }));
    const script = await generateRoastScript(roastPhotos, {
      eventType: booking.event_type,
      roastLevel: booking.roast_level || "light",
    });
    const scriptWithKeys = script.map((line, i) => ({ ...line, storage_key: enhancedKeys[i] }));

    await supabase.from("roast_scripts").insert({ booking_id: bookingId, script: scriptWithKeys, status: "pending" });
    await supabase.from("bookings").update({ status: "awaiting_roast_approval" }).eq("id", bookingId);

    // Constructing the Resend client throws synchronously when
    // RESEND_API_KEY is unset (e.g. local dev), which would otherwise
    // crash the pipeline here -- after the script and the
    // awaiting_roast_approval status are already saved. The script itself
    // is still valid and reviewable without the notification email, so a
    // send failure should be a warning, not a fatal error.
    try {
      const { sendRoastApprovalRequest } = require("../lib/email");
      await sendRoastApprovalRequest({
        to: booking.email,
        hostName: booking.host_name,
        eventName: `${booking.host_name}'s ${booking.event_type}`,
        reviewUrl: `${process.env.APP_URL}/roast/${bookingId}`,
      });
    } catch (err) {
      console.error(`Roast approval email failed (booking is still paused for approval): ${err.message}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`Roast script generated for booking ${bookingId}. Paused for host approval at ${process.env.APP_URL}/roast/${bookingId}`);
    return;
  }

  const musicPath = STYLE_MUSIC[booking.style];
  await finalizeDelivery(bookingId, localPaths, clipLocalPaths, enhancedKeys, tmpDir, musicPath, null, booking.email, booking.host_name, booking.tier);
}

async function finalizeDelivery(bookingId, localPaths, clipLocalPaths, enhancedKeys, tmpDir, musicPath, roastLines, hostEmail, hostName, tier) {
  console.log("Assembling automated slideshow video...");
  const videoLocalPath = path.join(tmpDir, "recap.mp4");
  await assembleSlideshow(localPaths, clipLocalPaths, videoLocalPath, musicPath, roastLines);
  const videoBuffer = fs.readFileSync(videoLocalPath);
  const videoKey = `deliverable/${bookingId}/full-cut.mp4`;
  await uploadToR2(videoKey, videoBuffer, "video/mp4");

  console.log("Writing deliverable record...");
  await supabase.from("deliverables").insert({
    booking_id: bookingId,
    full_video_key: videoKey,
    social_video_key: null,
    gallery_photo_keys: enhancedKeys,
  });

  const expiresAt = computeGalleryExpiry(tier);

  await supabase
    .from("bookings")
    .update({ status: "delivered", delivered_at: new Date().toISOString(), gallery_expires_at: expiresAt.toISOString() })
    .eq("id", bookingId);

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
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`Done. Booking ${bookingId} marked delivered with ${enhancedKeys.length} photos, ${clipLocalPaths.length} video clip(s), and a full-cut video.`);
}

if (require.main === module) {
  const bookingId = process.argv[2];
  if (!bookingId) {
    console.log("Usage: node scripts/auto-recap.js <bookingId>");
    process.exit(1);
  }
  runAutoRecap(bookingId).catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
  });
}

module.exports = { runAutoRecap };
