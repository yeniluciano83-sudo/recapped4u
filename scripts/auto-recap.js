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

// Tracks the active run's temp dir so runAutoRecap's catch can clean it up
// on ANY thrown error, not just the two spots inside runFullPipeline that
// already did this manually (leaving every other error path -- a failed
// enhancePhoto/uploadToR2/generateRoastScript/finalizeDelivery call -- to
// leak the downloaded/enhanced JPEGs on disk). Safe as a module-level
// variable only because this script processes one booking per process
// invocation (see runRecap's execSync call in poll-and-recap.js), never
// concurrent bookings in the same process.
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

// Signature/Luxe only, matching what those tiers actually advertise.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
const TARGET_SOCIAL_SECONDS = 75; // middle of the advertised 60-90s range
const MAX_SOCIAL_PHOTOS = 15;
// Luxe gets multiple social cuts, each from a different batch of top
// photos (cut 1 = must-includes + best remaining, cut 2 = next-best batch,
// and so on) -- real distinct content per cut, not just re-edits of the
// same shots. Signature stays at 1, matching what it's always advertised.
const SOCIAL_CUTS_COUNT = { keepsake: 5 };

// Paid tiers advertise unlimited uploads with no stated gallery cap, so
// their shortlist is genuinely uncapped -- every photo that clears the
// technical_quality bar in buildShortlist makes it in, how ever many that
// is. Only Free has a real, advertised cap (up to 20 photos). A paying
// customer's gallery being smaller than Free's was a real bug, not an
// acceptable default -- see the SHORTLIST_CAP lookup below.
const SHORTLIST_CAP = { free: 20 };
const FULL_CUT_TARGET_SECONDS = { free: 75 }; // middle of the advertised 60-90s range

// Host-starred "must include" photos always make the FIRST social cut,
// regardless of their AI quality score. That cut is filled out with the
// highest-scoring remaining photos up to MAX_SOCIAL_PHOTOS; each additional
// cut (Luxe only) takes the next-best batch after that, so multiple cuts
// are genuinely different content rather than re-edits of the same shots.
// Returns an array of selections (empty selections are omitted -- a small
// event's photo pool can easily run out before 5 cuts' worth exist).
function buildSocialSelections(analyzed, count) {
  const ranked = [...analyzed].sort(
    (a, b) => (b.analysis.emotional_strength + b.analysis.technical_quality) - (a.analysis.emotional_strength + a.analysis.technical_quality)
  );
  const mustInclude = ranked.filter((a) => a.upload.must_include_social).slice(0, MAX_SOCIAL_PHOTOS);
  const usedIds = new Set(mustInclude.map((a) => a.upload.id));
  const remaining = ranked.filter((a) => !usedIds.has(a.upload.id));

  const selections = [];
  const firstFillCount = MAX_SOCIAL_PHOTOS - mustInclude.length;
  const firstCut = [...mustInclude, ...remaining.slice(0, firstFillCount)];
  if (firstCut.length > 0) selections.push(firstCut);
  firstCut.slice(mustInclude.length).forEach((a) => usedIds.add(a.upload.id));

  let cursor = firstFillCount;
  for (let i = 1; i < count; i++) {
    const nextCut = remaining.slice(cursor, cursor + MAX_SOCIAL_PHOTOS);
    if (nextCut.length === 0) break;
    selections.push(nextCut);
    cursor += MAX_SOCIAL_PHOTOS;
  }
  return selections;
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

async function runAutoRecap(bookingId) {
  console.log(`Starting automated recap for booking ${bookingId}`);

  const { data: booking, error: bookingErr } = await supabase.from("bookings").select("*").eq("id", bookingId).single();
  if (bookingErr || !booking) throw new Error("Booking not found");

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
    if (currentTmpDir) {
      fs.rmSync(currentTmpDir, { recursive: true, force: true });
      currentTmpDir = null;
    }
    throw err;
  }
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
  currentTmpDir = tmpDir;

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

  // Signature/Luxe can choose "social cuts of every photo" instead of a
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
      await supabase.from("bookings").update({ status: "collecting" }).eq("id", bookingId);
      throw new Error(
        `No photos met the quality threshold for booking ${bookingId} -- reverted status to "collecting".`
      );
    }
  } else if (analyzed.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await supabase.from("bookings").update({ status: "collecting" }).eq("id", bookingId);
    throw new Error(`No usable photos (after moderation) for booking ${bookingId} -- reverted status to "collecting".`);
  }

  // The gallery always shows every non-flagged uploaded photo -- see
  // buildGallerySelection. This is a superset of videoShortlist (which stays
  // quality-gated for the actual video), so the video's local files below
  // reuse these already-enhanced buffers instead of enhancing twice.
  console.log("Auto-enhancing all uploaded photos for the gallery...");
  const gallerySelection = buildGallerySelection(analyzed, SHORTLIST_CAP[booking.tier] || Infinity);
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
  // it by listing rather than needing anything still in memory from this run.
  if (SOCIAL_CUT_ELIGIBLE_TIERS.includes(booking.tier)) {
    const socialCutsCount = useAllPhotoSocialCuts ? Infinity : (SOCIAL_CUTS_COUNT[booking.tier] || 1);
    const socialSelections = buildSocialSelections(analyzed, socialCutsCount);
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

  // Roast Reel captions the full video -- nothing to caption in "social cuts
  // of every photo" mode, so it's skipped there even if roast_enabled is
  // still set from a tier that includes it by default. Every intensity
  // level's prompt (lib/roast.js) carries a hard rule to roast the moment,
  // never a person's body/appearance/race, so the script needs no separate
  // host review before it's used.
  let roastLines = null;
  if (booking.roast_enabled && !useAllPhotoSocialCuts) {
    console.log("Roast Reel add-on enabled -- generating script...");
    const roastPhotos = localPaths.map((p, i) => ({ buffer: fs.readFileSync(p), storageKey: videoStorageKeys[i] }));
    const script = await generateRoastScript(roastPhotos, {
      eventType: booking.event_type,
      roastLevel: booking.roast_level || "light",
    });
    roastLines = script.map((line) => line.line);
  }

  // Style is optional at booking time (see app/booking/page.jsx) -- an
  // unset style still needs *some* soundtrack rather than silently
  // shipping a music-less video, so it falls back to documentary's track,
  // matching enhancePhoto's own documentary default for the color grade.
  const musicPath = booking.full_video_no_music ? null : STYLE_MUSIC[booking.style] || STYLE_MUSIC.documentary;
  const socialMusicPath = booking.social_style === "none" ? null : STYLE_MUSIC[booking.social_style || booking.style] || STYLE_MUSIC.documentary;
  await finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, booking.email, booking.host_name, booking.tier, socialMusicPath, useAllPhotoSocialCuts);
  currentTmpDir = null;
}

async function finalizeDelivery(bookingId, localPaths, enhancedKeys, tmpDir, musicPath, roastLines, hostEmail, hostName, tier, socialMusicPath, skipFullVideo = false) {
  let videoKey = null;
  let noRoastVideoKey = null;

  // "Social cuts of every photo" delivery format has no full video at all --
  // see useAllPhotoSocialCuts in runFullPipeline, the only caller that ever
  // passes skipFullVideo = true.
  if (!skipFullVideo) {
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
    videoKey = `deliverable/${bookingId}/full-cut.mp4`;
    await uploadToR2(videoKey, videoBuffer, "video/mp4");

    // Roast Reel bookings previously only ever got the captioned cut -- render
    // a second, caption-free twin of the exact same shortlist/pacing so hosts
    // can also share a version without the roast lines. Skipped for non-roast
    // bookings, where this would just be a duplicate of videoKey.
    if (roastLines) {
      console.log("Roast Reel enabled -- also assembling a caption-free version of the same cut...");
      const noRoastVideoLocalPath = path.join(tmpDir, "recap-no-roast.mp4");
      await assembleSlideshow(localPaths, [], noRoastVideoLocalPath, musicPath, null, fullCutSlotSeconds);
      const noRoastVideoBuffer = fs.readFileSync(noRoastVideoLocalPath);
      noRoastVideoKey = `deliverable/${bookingId}/full-cut-no-roast.mp4`;
      await uploadToR2(noRoastVideoKey, noRoastVideoBuffer, "video/mp4");
    }
  } else {
    console.log("Delivery format is social cuts of every photo -- skipping the full recap video.");
  }

  // The social cut(s)' photo selections were already uploaded to R2 in
  // runFullPipeline -- recover them here rather than needing anything still
  // in memory from that run. No roast
  // lines: social cuts never carry Roast Reel captions. Duration is hit by
  // solving for a per-slot length that lands each cut's sequence near
  // TARGET_SOCIAL_SECONDS, rather than using the full cut's fixed pacing.
  const socialVideoKeys = [];
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
      const socialVideoLocalPath = path.join(tmpDir, `social-cut-${cutIndex + 1}.mp4`);
      await assembleSlideshow(socialLocalPaths, [], socialVideoLocalPath, socialMusicPath, null, slotSeconds);
      const socialVideoBuffer = fs.readFileSync(socialVideoLocalPath);
      const socialVideoKey = `deliverable/${bookingId}/social-cut-${cutIndex + 1}.mp4`;
      await uploadToR2(socialVideoKey, socialVideoBuffer, "video/mp4");
      socialVideoKeys.push(socialVideoKey);
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
      // social_video_key (singular) kept in sync with the first cut for
      // anything still reading it (e.g. poll-and-recap.js's purge step);
      // social_video_keys is the real, complete list.
      social_video_key: socialVideoKeys[0] || null,
      social_video_keys: socialVideoKeys,
      gallery_photo_keys: enhancedKeys,
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
  // window passes (7 days Free, 2/4/6 months Classic/Signature/Luxe -- see
  // GALLERY_EXPIRY_DAYS/MONTHS above), matching what the Privacy
  // Policy/FAQ promise. See purgeExpiredGalleries() in
  // scripts/poll-and-recap.js, which reads this.
  const galleryPurgeAt = expiresAt.toISOString();

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

  console.log(`Done. Booking ${bookingId} marked delivered with ${enhancedKeys.length} photos${skipFullVideo ? "" : ", a full-cut video,"} and ${socialVideoKeys.length} social cut(s).`);
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
