/**
 * Recapped For You — Fully Automated Recap Pipeline
 * ----------------------------------------------------
 * Given a booking ID, this script does everything end-to-end with no
 * human editing step:
 *
 *   1. Pulls the booking's raw uploads from Supabase + R2
 *   2. Sends each photo to Claude for curation (score + shortlist + story arc)
 *   3. Auto-enhances the shortlisted photos (color, sharpness, style grade)
 *   4. Assembles an automated slideshow video (Ken Burns + crossfades + a
 *      royalty-free soundtrack matched to the booking's editing style)
 *   5. Uploads the finished photos + video to R2 under a deliverable/ path
 *   6. Writes the `deliverables` row and flips the booking to "delivered"
 *
 * Run: node scripts/auto-recap.js <bookingId>
 */
require("dotenv").config({ path: require("path").join(__dirname,"..",".env.local") });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { enhancePhoto } = require("../lib/photo-enhance");
const { assembleSlideshow } = require("../lib/video-assemble");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Royalty-free tracks (Pixabay License — free for commercial use, no
// attribution required), one per editing style, matching the mood
// described for that style on the booking page.
const STYLE_MUSIC = {
  cinematic: path.join(__dirname, "..", "lib", "music", "cinematic.mp3"),
  upbeat: path.join(__dirname, "..", "lib", "music", "upbeat.mp3"),
  documentary: path.join(__dirname, "..", "lib", "music", "documentary.mp3"),
};

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

async function callClaude(messages, maxTokens = 1024) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages }),
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

  await supabase.from("bookings").update({ status: "editing" }).eq("id", bookingId);

  const { data: uploads, error: uploadsErr } = await supabase.from("uploads").select("*").eq("booking_id", bookingId).eq("file_type", "photo");
  if (uploadsErr) throw uploadsErr;
  if (!uploads || uploads.length === 0) throw new Error("No photo uploads found for this booking");

  console.log(`Found ${uploads.length} raw photos. Downloading and analyzing...`);

  const analyzed = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-"));

  for (const upload of uploads) {
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

  const shortlist = await buildShortlist(analyzed);
  console.log(`Shortlisted ${shortlist.length} photos for the final gallery.`);

  if (shortlist.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await supabase.from("bookings").update({ status: "collecting" }).eq("id", bookingId);
    throw new Error(
      `No photos met the quality threshold for booking ${bookingId} -- reverted status to "collecting".`
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

  console.log("Assembling automated slideshow video...");
  const musicPath = STYLE_MUSIC[booking.style];
  const videoLocalPath = path.join(tmpDir, "recap.mp4");
  await assembleSlideshow(localPaths, videoLocalPath, musicPath);
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

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  await supabase
    .from("bookings")
    .update({ status: "delivered", delivered_at: new Date().toISOString(), gallery_expires_at: expiresAt.toISOString() })
    .eq("id", bookingId);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`Done. Booking ${bookingId} marked delivered with ${enhancedKeys.length} photos and a full-cut video.`);
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
