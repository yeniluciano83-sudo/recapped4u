/**
 * Recapped For You — Fully Automated Recap Pipeline
 * ----------------------------------------------------
 * Given a booking ID, this script does everything end-to-end with no
 * human editing step. Photos only -- guests upload photos, never video
 * (enforced at the upload API), so there's no raw footage to incorporate:
 *
 *   1. Pulls the booking's raw uploaded photos from Supabase + R2
 *   2. Sends each photo to Claude for curation (score + shortlist)
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
const ffmpeg = require("fluent-ffmpeg");
// See the matching comment in lib/video-assemble.js -- ffmpeg-static's
// Linux binary is missing the drawtext filter, so CI sets FFMPEG_PATH to
// a real system ffmpeg instead.
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || require("ffmpeg-static"));
const { createClient } = require("@supabase/supabase-js");
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { enhancePhoto } = require("../lib/photo-enhance");
const { assembleSlideshow } = require("../lib/video-assemble");
const { generateRoastScript } = require("../lib/roast");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Royalty-free tracks (Pixabay License — free for commercial use, no
// attribution required), one per editing style, matching the mood
// described for that style on the booking page.
//
// Only 3 dedicated tracks exist -- retro and highlight had no entry at
// all, so any booking using either style got a video with silently no
// music (STYLE_MUSIC[style] was undefined, which assembleSlideshow
// treats as "skip audio" rather than erroring). Until dedicated tracks
// are sourced, map them to the closest mood match rather than ship a
// silent video: retro's warm/nostalgic feel is closer to cinematic than
// documentary's minimal/candid feel; highlight's bold sports-style energy
// is a direct match for upbeat's fast-cuts/high-energy track.
const STYLE_MUSIC = {
  cinematic: path.join(__dirname, "..", "lib", "music", "cinematic.mp3"),
  upbeat: path.join(__dirname, "..", "lib", "music", "upbeat.mp3"),
  documentary: path.join(__dirname, "..", "lib", "music", "documentary.mp3"),
  retro: path.join(__dirname, "..", "lib", "music", "cinematic.mp3"),
  highlight: path.join(__dirname, "..", "lib", "music", "upbeat.mp3"),
};

// Signature/Luxe only, matching what those tiers actually advertise.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
const TARGET_SOCIAL_SECONDS = 75; // middle of the advertised 60-90s range
const MAX_SOCIAL_PHOTOS = 15;

// Paid tiers advertise unlimited uploads with no stated gallery cap, so
// their shortlist is genuinely uncapped -- every photo that clears the
// technical_quality bar in buildShortlist makes it in, how ever many that
// is. Only Free has a real, advertised cap (up to 20 photos). A paying
// customer's gallery being smaller than Free's was a real bug, not an
// acceptable default -- see the SHORTLIST_CAP lookup below.
const SHORTLIST_CAP = { free: 20 };
const FULL_CUT_TARGET_SECONDS = { free: 75 }; // middle of the advertised 60-90s range

// Host-starred "must include" photos always make the social cut,
// regardless of their AI quality score -- filled out with the
// highest-scoring remaining shortlist photos up to MAX_SOCIAL_PHOTOS.
function buildSocialSelection(analyzed, shortlist) {
  const mustInclude = analyzed.filter((a) => a.upload.must_include_social).slice(0, MAX_SOCIAL_PHOTOS);
  const mustIncludeIds = new Set(mustInclude.map((a) => a.upload.id));
  const fill = shortlist.filter((s) => !mustIncludeIds.has(s.upload.id)).slice(0, MAX_SOCIAL_PHOTOS - mustInclude.length);
  return [...mustInclude, ...fill];
}

// Classic's gallery stays downloadable for 2 months, Signature's for 4,
// and Luxe's for 6. Free's gallery is downloadable for 7 days total, then
// permanently deleted (see galleryPurgeAt below, which is set to this same
// date for free). Anything not listed here falls back to 90 days.
const GALLERY_EXPIRY_DAYS = { free: 7 };
const GALLERY_EXPIRY_MONTHS = { standard: 2, premium: 4, keepsake: 6 };

function computeGalleryExpiry(tier) {
  const expiresAt = new Date();
  const days = GALLERY_EXPIRY_DAYS[tier];
  const months = GALLERY_EXPIRY_MONTHS[tier];
  if (days) {
    expiresAt.setDate(expiresAt.getDate() + days);
  } else if (months) {
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

async function deleteFromR2(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Used to recover the social cut's photo selection a prior run already
// uploaded, without re-analyzing/re-enhancing it -- it survives a
// roast-approval pause this way, since finalizeDelivery may run in a
// completely separate process invocation after approval.
async function listDeliverableFiles(bookingId, prefix) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `deliverable/${bookingId}/${prefix}` }));
  return (res.Contents || []).map((o) => o.Key).sort();
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

// `flagged`/`flag_reason` implement the "Acceptable use" terms (sexually
// explicit content or nudity isn't allowed) -- checked on every photo.
async function analyzePhoto(buffer, mediaType) {
  const prompt = `Analyze this event photo. Also check whether it contains nudity or sexually explicit content that would be inappropriate for a general event recap shared with the host and their guests. Respond ONLY with JSON: {"technical_quality": 1-10, "emotional_strength": 1-10, "moment_type": "string", "notes": "short phrase", "flagged": boolean, "flag_reason": "short phrase or null"}`;
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

  // A booking that already has a roast_scripts row has already been
  // analyzed and enhanced -- re-running the full pipeline would redo that
  // (wasted Claude spend) and generate a second, conflicting script. Resume
  // at final rendering instead. Checking for the row's existence rather
  // than booking.status === "awaiting_roast_approval" directly matters for
  // poll-and-recap.js's atomic claim (which flips status to "editing"
  // before invoking this, to close a race where an overlapping run could
  // otherwise pick up the same booking twice) -- this way the dispatch is
  // correct no matter which status the booking is claimed from.
  const { data: existingRoastScript } = await supabase
    .from("roast_scripts")
    .select("id")
    .eq("booking_id", bookingId)
    .limit(1)
    .maybeSingle();

  if (existingRoastScript) {
    try {
      return await finishAfterRoastApproval(booking);
    } catch (err) {
      // Same reasoning as the runFullPipeline catch below -- without this,
      // a failure here (e.g. the ffmpeg render itself) left the booking
      // stuck at "editing" forever, since neither processCollectingBookings
      // nor resumeApprovedRoastBookings re-query that status. Revert to
      // awaiting_roast_approval (not collecting) so the next run retries
      // just the render, not the whole analysis pipeline -- the approved
      // roast_scripts row is untouched either way.
      await supabase.from("bookings").update({ status: "awaiting_roast_approval" }).eq("id", bookingId).eq("status", "editing");
      throw err;
    }
  }

  try {
    return await runFullPipeline(booking);
  } catch (err) {
    // Without this, any failure partway through runFullPipeline (network
    // blip, API error, anything) leaves the booking stuck at "editing"
    // forever -- processCollectingBookings only re-queries
    // status === "collecting", so nothing would ever retry it
    // automatically. Revert so the next scheduled run picks it back up.
    // Guarded on status still being "editing" so this doesn't clobber a
    // status change that happened for another reason mid-run (e.g. the
    // zero-shortlist case above already reverts to "collecting" itself,
    // or the host cancelled the booking while this was running).
    await supabase.from("bookings").update({ status: "collecting" }).eq("id", bookingId).eq("status", "editing");
    throw err;
  }
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

  const enhancedKeys = roastScript.script.map((entry) => entry.storage_key);
  const musicPath = STYLE_MUSIC[booking.style];
  const socialMusicPath = STYLE_MUSIC[booking.social_style || booking.style];
  await finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, booking.email, booking.host_name, booking.tier, socialMusicPath);
}

async function runFullPipeline(booking) {
  const bookingId = booking.id;

  await supabase.from("bookings").update({ status: "editing" }).eq("id", bookingId);

  const { data: uploads, error: uploadsErr } = await supabase.from("uploads").select("*").eq("booking_id", bookingId);
  if (uploadsErr) throw uploadsErr;
  if (!uploads || uploads.length === 0) throw new Error("No uploads found for this booking");

  const photoUploads = uploads.filter((u) => u.file_type === "photo");

  console.log(`Found ${photoUploads.length} raw photos. Downloading and analyzing...`);

  const analyzed = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-"));

  // Terms of Service, "Acceptable use": we can reject specific photos/videos
  // for nudity or sexually explicit content. Flagged uploads are removed
  // from R2 and the uploads table entirely -- not just excluded from the
  // shortlist -- so they don't linger in storage or get a second look.
  async function rejectFlaggedUpload(upload, analysis, label) {
    console.log(`  ⚠ ${upload.storage_key}${label} — flagged (${analysis.flag_reason || "inappropriate content"}), removing`);
    try {
      await deleteFromR2(upload.storage_key);
    } catch (err) {
      console.error(`    failed to delete ${upload.storage_key} from R2: ${err.message}`);
    }
    await supabase.from("uploads").delete().eq("id", upload.id);
  }

  for (const upload of photoUploads) {
    try {
      const buffer = await downloadFromR2(upload.storage_key);
      const ext = path.extname(upload.storage_key).toLowerCase();
      const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
      const analysis = await analyzePhoto(buffer, mediaType);
      if (analysis.flagged) {
        await rejectFlaggedUpload(upload, analysis, "");
        continue;
      }
      analyzed.push({ upload, buffer, analysis });
      console.log(`  ✓ ${upload.storage_key} — quality ${analysis.technical_quality}, emotion ${analysis.emotional_strength}`);
    } catch (err) {
      console.error(`  ✗ ${upload.storage_key} — analysis failed: ${err.message}`);
    }
  }

  const shortlist = await buildShortlist(analyzed, SHORTLIST_CAP[booking.tier] || Infinity);
  console.log(`Shortlisted ${shortlist.length} photos for the final cut.`);

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
  const enhancedByUploadId = new Map(); // reused below for the social cut selection, so must-include photos already in the main shortlist aren't enhanced twice

  for (let i = 0; i < shortlist.length; i++) {
    const { buffer, upload } = shortlist[i];
    const enhanced = await enhancePhoto(buffer, booking.style);
    const key = `deliverable/${bookingId}/photo-${i + 1}.jpg`;
    await uploadToR2(key, enhanced, "image/jpeg");
    enhancedKeys.push(key);
    enhancedByUploadId.set(upload.id, enhanced);

    const localPath = path.join(tmpDir, `photo-${i + 1}.jpg`);
    fs.writeFileSync(localPath, enhanced);
    localPaths.push(localPath);
  }

  // The social cut's photo selection can include host-starred photos that
  // didn't make the main shortlist -- upload the whole selection under its
  // own R2 prefix now, so it survives a roast-approval pause: finalizeDelivery
  // recovers it by listing rather than needing anything still in memory
  // from this run.
  if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier)) {
    const socialSelection = buildSocialSelection(analyzed, shortlist);
    console.log(`Uploading ${socialSelection.length} photo(s) for the social cut selection...`);
    for (let i = 0; i < socialSelection.length; i++) {
      const { buffer, upload } = socialSelection[i];
      const enhanced = enhancedByUploadId.get(upload.id) || (await enhancePhoto(buffer, booking.style));
      // "social-photo-", not "social-" -- a plain "social-" prefix also
      // matches the rendered "social-cut.mp4" output further down (an S3
      // prefix listing has no concept of "photos only"). Harmless on a
      // booking's first delivery since that file doesn't exist yet when
      // this uploads, but on a reprocess it's already sitting in R2 from
      // the prior run, gets listed alongside the real photos below, and
      // ffmpeg rejects it with "Option loop not found" when it's fed in
      // as an image input -- confirmed live reprocessing a real booking.
      await uploadToR2(`deliverable/${bookingId}/social-photo-${i + 1}.jpg`, enhanced, "image/jpeg");
    }
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
  const socialMusicPath = STYLE_MUSIC[booking.social_style || booking.style];
  await finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, null, booking.email, booking.host_name, booking.tier, socialMusicPath);
}

async function finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, hostEmail, hostName, tier, socialMusicPath) {
  console.log("Assembling automated slideshow video...");
  const videoLocalPath = path.join(tmpDir, "recap.mp4");

  // Free's highlight video targets a duration (like the social cut) rather
  // than the other tiers' fixed per-photo pacing that scales with however
  // many photos made the shortlist. Same duration-solving math as the
  // social cut; see the comment further down for the formula itself.
  const fullCutTarget = FULL_CUT_TARGET_SECONDS[tier];
  const fullCutSlotSeconds = fullCutTarget ? (fullCutTarget + (localPaths.length - 1) * 0.6) / localPaths.length : undefined;

  await assembleSlideshow(localPaths, [], videoLocalPath, musicPath, roastLines, fullCutSlotSeconds);
  const videoBuffer = fs.readFileSync(videoLocalPath);
  const videoKey = `deliverable/${bookingId}/full-cut.mp4`;
  await uploadToR2(videoKey, videoBuffer, "video/mp4");

  // The social cut's photo selection was already uploaded to R2 in
  // runFullPipeline (before any roast-approval pause) -- recover it here
  // rather than needing anything still in memory from that run. No roast
  // lines: the social cut never carries Roast Reel captions. Duration is
  // hit by solving for a per-slot length that lands the whole sequence
  // near TARGET_SOCIAL_SECONDS, rather than using the full cut's fixed
  // per-slot pacing.
  let socialVideoKey = null;
  if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(tier)) {
    const socialKeys = await listDeliverableFiles(bookingId, "social-photo-");
    if (socialKeys.length > 0) {
      console.log(`Assembling social cut from ${socialKeys.length} photo(s)...`);
      const socialLocalPaths = [];
      for (const key of socialKeys) {
        const buffer = await downloadFromR2(key);
        const localPath = path.join(tmpDir, path.basename(key));
        fs.writeFileSync(localPath, buffer);
        socialLocalPaths.push(localPath);
      }
      // Solve for the per-slot duration that lands the whole crossfaded
      // sequence at TARGET_SOCIAL_SECONDS: total = n*d - (n-1)*transition,
      // so d = (target + (n-1)*transition) / n. 0.6 here must match
      // TRANSITION_SECONDS in lib/video-assemble.js (not exported -- it's
      // a small, stable constant, not worth an export for one call site).
      const CROSSFADE_TRANSITION_SECONDS = 0.6;
      const slotSeconds = (TARGET_SOCIAL_SECONDS + (socialLocalPaths.length - 1) * CROSSFADE_TRANSITION_SECONDS) / socialLocalPaths.length;
      const socialVideoLocalPath = path.join(tmpDir, "social-cut.mp4");
      await assembleSlideshow(socialLocalPaths, [], socialVideoLocalPath, socialMusicPath, null, slotSeconds);
      const socialVideoBuffer = fs.readFileSync(socialVideoLocalPath);
      socialVideoKey = `deliverable/${bookingId}/social-cut.mp4`;
      await uploadToR2(socialVideoKey, socialVideoBuffer, "video/mp4");
    }
  }

  console.log("Writing deliverable record...");
  await supabase.from("deliverables").insert({
    booking_id: bookingId,
    full_video_key: videoKey,
    social_video_key: socialVideoKey,
    gallery_photo_keys: enhancedKeys,
  });

  const expiresAt = computeGalleryExpiry(tier);

  // Free's finished gallery/video had no deletion cutoff at all previously --
  // once delivered it stayed downloadable forever. It's now deleted the same
  // moment the gallery itself expires (7 days after delivery, see
  // GALLERY_EXPIRY_DAYS above); see purgeExpiredFreeGalleries() in
  // scripts/poll-and-recap.js, which reads this.
  const galleryPurgeAt = tier === "free" ? expiresAt.toISOString() : null;

  await supabase
    .from("bookings")
    .update({ status: "delivered", delivered_at: new Date().toISOString(), gallery_expires_at: expiresAt.toISOString(), gallery_purge_at: galleryPurgeAt })
    .eq("id", bookingId);

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
  }

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
