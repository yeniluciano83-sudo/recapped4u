/**
 * Recapped For You — Scheduled recap runner
 * -------------------------------------------
 * Meant to run on a schedule (see .github/workflows/recap-scheduler.yml).
 * Each run:
 *
 *   1. Finds bookings still "collecting" whose event was >= that tier's
 *      upload deadline ago (see TIER_SCHEDULE) -- or whose host has
 *      manually closed uploads early via the QR share page -- and submits
 *      each one's photo analysis as a Claude Message Batch (50% cheaper
 *      than analyzing one photo at a time, see lib/batchAnalysis.js).
 *   2. Checks every booking still "analyzing" from a prior run's batch --
 *      once it's done (or has taken too long, see BATCH_FALLBACK_HOURS),
 *      continues that booking through the rest of the auto-recap pipeline
 *      (enhancement, video assembly, delivery). Submitting and finishing
 *      are two separate steps, possibly hours apart across separate runs
 *      of this script, because a batch can take far longer than this
 *      scheduler's own 20-minute job budget allows for.
 *   3. Finds bookings still "collecting" past that tier's reminder
 *      threshold (but before the deadline), with no reminder sent yet,
 *      and emails the host a heads-up that processing starts soon.
 *   4. Permanently deletes raw guest uploads whose purge_at (set to 30 days
 *      after delivery, see finalizeDelivery in auto-recap.js) has passed --
 *      matching the retention policy already promised in the UI copy.
 *   5. Permanently deletes any booking's finished gallery/video (R2 objects
 *      + the deliverables row) whose gallery_purge_at (set to each tier's
 *      retention window after delivery -- 7 days Free, 2/4/6 months
 *      Highlight/Spotlight/Luxe) has passed, matching the retention policy
 *      promised in the Privacy Policy/FAQ.
 *
 * If any booking's pipeline run fails, it's logged and the run moves on to
 * the next one -- at the end, if ADMIN_ALERT_EMAIL is set, one summary
 * email listing every failure from this run is sent (not one email per
 * failure, to avoid flooding the inbox when several fail in the same run).
 *
 * event_date is a bare DATE column (no time-of-day) -- these thresholds
 * are measured from midnight UTC of that date, so they're accurate to
 * within a day, not to the hour.
 *
 * Run manually: node scripts/poll-and-recap.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const path = require("path");
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const { hoursSinceEvent, sortByProcessingPriority } = require("../lib/processingPriority");
const { captureError, flushSentry } = require("../lib/sentry");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Free's deadline is deliberately tight (encourages upgrading for more
// time) and skips a reminder entirely -- a same-day heads-up doesn't fit a
// 24h window. Highlight keeps the original 48h/24h pairing. Spotlight gets a
// week (reminder a day before). Luxe gets two weeks, reminded after the
// first week.
const TIER_SCHEDULE = {
  free: { processHours: 24, reminderHours: null },
  standard: { processHours: 48, reminderHours: 24 },
  premium: { processHours: 24 * 7, reminderHours: 24 * 6 },
  keepsake: { processHours: 24 * 14, reminderHours: 24 * 7 },
};

function runSubmitAnalysis(bookingId) {
  execSync(`node "${path.join(__dirname, "auto-recap.js")}" submit ${bookingId}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

function runResumeAnalysis(bookingId) {
  execSync(`node "${path.join(__dirname, "auto-recap.js")}" resume ${bookingId}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

function runContinueRender(bookingId, budgetMs) {
  execSync(`node "${path.join(__dirname, "auto-recap.js")}" continue-render ${bookingId} ${Math.round(budgetMs)}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

// The render phase (advancing in-progress 4K renders) runs first in main()
// and must leave enough of the CI job's 75-minute budget for analysis,
// collecting, and the purges -- so it gets a shared wall-clock ceiling that
// every continue-render this run does draws down together, rather than each
// booking getting its own fresh 35 minutes (which N>=3 in-progress renders
// would blow the whole job on).
// #### TEMPORARY FOR MULTI-RUN TESTING -- REVERT BEFORE MERGING PR #1 ####
// Shrunk so a manually-triggered workflow run (from the Actions tab, branch
// = fix/resumable-rendering) forces even a normal-sized booking through
// several ticks instead of finishing in one -- exercises the resume path
// without waiting for a genuinely huge booking. Real values commented out.
const RENDER_PHASE_BUDGET_MS = 3 * 60 * 1000;
const PER_RENDER_BUDGET_MS = 1 * 60 * 1000; // cap for any single booking's slice
const MIN_RENDER_SLICE_MS = 30 * 1000; // don't bother spawning for less than this
const RENDER_LOCK_TTL_MS = 3 * 60 * 1000; // short, so back-to-back manual triggers a few minutes apart don't see a stale lock as still held
// const RENDER_PHASE_BUDGET_MS = 45 * 60 * 1000;
// const PER_RENDER_BUDGET_MS = 35 * 60 * 1000;
// const MIN_RENDER_SLICE_MS = 4 * 60 * 1000;
// const RENDER_LOCK_TTL_MS = PER_RENDER_BUDGET_MS + 15 * 60 * 1000;
// #### END TEMPORARY ####

// See lib/processingPriority.js for hoursSinceEvent/sortByProcessingPriority
// -- the queue-ordering logic (Luxe's advertised "24-hour priority
// turnaround") that this script uses below.

async function processCollectingBookings(failures) {
  const { data: bookings, error } = await supabase.from("bookings").select("*").eq("status", "collecting");
  if (error) {
    console.error("Failed to query collecting bookings:", error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: "query-collecting" } });
    return;
  }

  for (const booking of sortByProcessingPriority(bookings || [])) {
    const schedule = TIER_SCHEDULE[booking.tier];
    if (!schedule) {
      console.error(`Booking ${booking.id} has unrecognized tier "${booking.tier}" -- skipping.`);
      captureError(new Error(`Booking has unrecognized tier "${booking.tier}"`), {
        tags: { script: "poll-and-recap", step: "unrecognized-tier" },
        extra: { bookingId: booking.id },
      });
      continue;
    }

    const hours = hoursSinceEvent(booking.event_date);
    const closedEarly = Boolean(booking.uploads_closed_at);
    const extensionHours = booking.deadline_extension_hours || 0;
    const effectiveProcessHours = schedule.processHours + extensionHours;

    if (hours >= effectiveProcessHours || closedEarly) {
      // A booking with zero uploads past its deadline can never succeed --
      // auto-recap.js just throws "No uploads found for this booking" (see
      // its own guard) every single time it's attempted. Left alone, that
      // means claiming it, running the pipeline, and failing on an endless
      // 3-hour cycle forever (confirmed live: one abandoned free-tier
      // booking generated a "1 booking failed this run" alert daily until
      // manually cancelled). Checking first turns that into one clear,
      // actionable line instead of a generic crash the alert email gives
      // no way to tell apart from a real bug.
      const { count: uploadCount } = await supabase
        .from("uploads")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", booking.id);

      if (!uploadCount) {
        console.log(`\nBooking ${booking.id} has 0 uploads and is past its deadline -- skipping (likely abandoned).`);
        failures.push({
          bookingId: booking.id,
          error: `"${booking.host_name}" has 0 uploads and is past its processing deadline (event was ~${Math.round(hours)}h ago) -- likely abandoned. Cancel it or follow up with the host.`,
        });
        continue;
      }

      // Atomic claim: this run and an overlapping one (e.g. a manual
      // workflow_dispatch landing near the top of the hour, next to the
      // cron tick) could otherwise both see this booking as "collecting"
      // from their own initial query and both process it, generating
      // duplicate roast scripts/emails. The conditional .eq("status",
      // "collecting") means only one run's UPDATE actually matches a row.
      // Claims into "analyzing" (not "editing") -- submitting the photo
      // analysis batch is the first step now, see processAnalyzingBookings
      // below for what picks it up once that batch is done.
      const { data: claimed } = await supabase
        .from("bookings")
        .update({ status: "analyzing", processing_started_at: new Date().toISOString() })
        .eq("id", booking.id)
        .eq("status", "collecting")
        .select("id")
        .maybeSingle();

      if (!claimed) {
        console.log(`\nBooking ${booking.id} was already claimed by another run -- skipping.`);
        continue;
      }

      const reason = closedEarly ? "host closed uploads early" : `event was ~${Math.round(hours)}h ago`;
      console.log(`\nSubmitting analysis batch for booking ${booking.id} (${booking.tier}, ${reason})...`);
      try {
        runSubmitAnalysis(booking.id);
      } catch (err) {
        console.error(`Booking ${booking.id} failed:`, err.message);
        captureError(err, { tags: { script: "poll-and-recap", step: "submit-analysis" }, extra: { bookingId: booking.id } });
        failures.push({ bookingId: booking.id, error: err.message });
      }
      continue;
    }

    if (schedule.reminderHours !== null && hours >= schedule.reminderHours + extensionHours && !booking.reminder_sent_at) {
      // Same atomic-claim reasoning as the recap-trigger path above: two
      // overlapping poll runs could otherwise both see reminder_sent_at as
      // null and both email the host. Claiming before sending (rather than
      // after) means a failed send is never retried -- a missed reminder
      // instead of a duplicate one, the safer failure mode for an email.
      const { data: claimed } = await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();

      if (!claimed) {
        console.log(`Reminder for booking ${booking.id} was already claimed by another run -- skipping.`);
        continue;
      }

      console.log(`Sending upload reminder for booking ${booking.id}...`);
      try {
        // Lazy require: constructing the Resend client throws synchronously
        // when RESEND_API_KEY is unset, which would otherwise crash this
        // whole poll run (including bookings that don't need an email at
        // all) rather than just this one reminder.
        const { sendUploadReminder } = require("../lib/email");
        await sendUploadReminder({
          to: booking.email,
          hostName: booking.host_name,
          eventDate: booking.event_date,
          uploadUrl: `${process.env.APP_URL}/event/${booking.upload_slug}`,
          uploadSlug: booking.upload_slug,
          tier: booking.tier,
        });
      } catch (err) {
        console.error(`Reminder email failed for booking ${booking.id}: ${err.message}`);
        captureError(err, { tags: { script: "poll-and-recap", email: "upload-reminder" }, extra: { bookingId: booking.id } });
      }
    }
  }
}

// Every "analyzing" booking has a Claude photo-analysis batch in flight
// (submitted by processCollectingBookings above, see lib/batchAnalysis.js
// for why this can't just block and wait inside that same run). Checked
// again on every tick: most batches are done well within this scheduler's
// 3-hour cadence, and auto-recap.js's resume step falls back to synchronous
// analysis on its own once a batch has taken too long, so this loop just
// needs to keep giving each one another chance to finish.
async function processAnalyzingBookings(failures) {
  const { data: bookings, error } = await supabase.from("bookings").select("*").eq("status", "analyzing");
  if (error) {
    console.error("Failed to query analyzing bookings:", error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: "query-analyzing" } });
    return;
  }
  if (!bookings || bookings.length === 0) return;

  console.log(`\nChecking ${bookings.length} booking(s) with an in-flight analysis batch...`);
  for (const booking of sortByProcessingPriority(bookings)) {
    try {
      runResumeAnalysis(booking.id);
    } catch (err) {
      console.error(`Resuming analysis for booking ${booking.id} failed:`, err.message);
      captureError(err, { tags: { script: "poll-and-recap", step: "resume-analysis" }, extra: { bookingId: booking.id } });
      failures.push({ bookingId: booking.id, error: err.message });
    }
  }
}

// A non-null render_state (on the deliverable row) always means a 4K render
// is part-way through -- driveRender in auto-recap.js nulls it the moment
// it finishes. A large render legitimately spans several of these runs;
// give each one another slice of wall time per tick. Two booking statuses
// carry a resumable render: "editing" (a normal first delivery) and
// "delivered" (a manual `full-video` re-render that got killed mid-run).
// Any other status with a leftover render_state is dead work -- clear it
// and sweep its scratch prefix. A failure advancing a render does NOT
// revert the booking: render_state is the checkpoint, the next run resumes.
async function processRenderingBookings(failures) {
  const { deleteByPrefix } = require("../lib/storage");

  const { data: dels, error } = await supabase.from("deliverables").select("booking_id").not("render_state", "is", null);
  if (error) {
    console.error("Failed to query in-progress renders:", error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: "query-renders" } });
    return;
  }
  if (!dels || dels.length === 0) return;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, host_name, status, render_lock_at")
    .in("id", dels.map((d) => d.booking_id));

  const inProgress = [];
  for (const b of bookings || []) {
    if (b.status === "editing" || b.status === "delivered") {
      inProgress.push(b);
    } else {
      // Cancelled (or otherwise abandoned) mid-render -- nothing will ever
      // resume it. Drop the checkpoint and the scratch files.
      console.log(`Booking ${b.id} is "${b.status}" with a leftover render_state -- clearing it and its _render/ scratch.`);
      await supabase.from("deliverables").update({ render_state: null }).eq("booking_id", b.id);
      await deleteByPrefix(`deliverable/${b.id}/_render/`).catch((e) => console.error(`  _render/ sweep failed for ${b.id}: ${e.message}`));
    }
  }
  if (inProgress.length === 0) return;

  console.log(`\n${inProgress.length} render(s) in progress -- advancing within a ${Math.round(RENDER_PHASE_BUDGET_MS / 60000)}m shared budget...`);
  const phaseDeadline = Date.now() + RENDER_PHASE_BUDGET_MS;
  const lockStaleCutoff = Date.now() - RENDER_LOCK_TTL_MS;

  for (const booking of inProgress) {
    const remainingMs = phaseDeadline - Date.now();
    if (remainingMs < MIN_RENDER_SLICE_MS) {
      console.log(`Render phase budget spent -- remaining render(s) continue next run.`);
      break;
    }

    // Skip a booking whose render lock is still fresh -- another poll run
    // (a cron tick next to a manual workflow_dispatch) is already advancing
    // it. A stale lock (older than RENDER_LOCK_TTL_MS) means that run
    // crashed holding it; take it over.
    if (booking.render_lock_at && new Date(booking.render_lock_at).getTime() > lockStaleCutoff) {
      console.log(`Render for booking ${booking.id} is locked by another run -- skipping this tick.`);
      continue;
    }

    // Atomic compare-and-swap on the exact lock value we just read, guarded
    // on the status we read too: if a concurrent run claimed it (or the
    // booking's status moved) in between, our update matches no row.
    const myLock = new Date().toISOString();
    let claim = supabase.from("bookings").update({ render_lock_at: myLock }).eq("id", booking.id).eq("status", booking.status);
    claim = booking.render_lock_at == null ? claim.is("render_lock_at", null) : claim.eq("render_lock_at", booking.render_lock_at);
    const { data: claimed } = await claim.select("id").maybeSingle();
    if (!claimed) {
      console.log(`Render for booking ${booking.id} was claimed by another run -- skipping this tick.`);
      continue;
    }

    try {
      runContinueRender(booking.id, Math.min(PER_RENDER_BUDGET_MS, remainingMs));
    } catch (err) {
      console.error(`Continuing render for booking ${booking.id} failed:`, err.message);
      captureError(err, { tags: { script: "poll-and-recap", step: "continue-render" }, extra: { bookingId: booking.id } });
      failures.push({ bookingId: booking.id, error: `Render step failed (will resume from its checkpoint next run): ${err.message}` });
    } finally {
      // Release only our own lock -- lets the next run pick it straight up
      // rather than waiting out the TTL. Matched on myLock so we never
      // clobber a lock a subsequent run has already taken.
      await supabase.from("bookings").update({ render_lock_at: null }).eq("id", booking.id).eq("render_lock_at", myLock);
    }
  }
}

// A real synchronous run (photo analysis + video encoding for a handful of
// bookings) finishes in minutes. If a booking is still "editing" after this
// long, the process that claimed it was killed before reaching its own
// catch block (job timeout -- see the 20-minute limit in
// .github/workflows/recap-scheduler.yml -- OOM, or a crash) and never
// reverted itself. Left alone, that booking is invisible forever: this is
// the only thing that ever looks at status = "editing" again.
const STALE_EDITING_HOURS = 1.5;

// "analyzing" bookings wait on a Claude batch that can legitimately take
// hours -- BATCH_FALLBACK_HOURS (lib/batchAnalysis.js) normally moves a
// booking out of "analyzing" on its own well before this, so this threshold
// is only meant to catch a genuinely abandoned booking (the submit/resume
// process itself was killed before it could revert), not a slow-but-healthy
// batch -- set comfortably past the fallback threshold plus a couple of
// retry cycles at this scheduler's 3-hour cadence.
const STALE_ANALYZING_HOURS = 12;

async function recoverStaleBookings(failures) {
  await recoverStaleBookingsInStatus(failures, "editing", STALE_EDITING_HOURS);
  await recoverStaleBookingsInStatus(failures, "analyzing", STALE_ANALYZING_HOURS);
}

async function recoverStaleBookingsInStatus(failures, status, staleHours) {
  const staleCutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await supabase
    .from("bookings")
    .select("id, host_name, processing_started_at")
    .eq("status", status)
    .lt("processing_started_at", staleCutoff);

  if (error) {
    console.error(`Failed to query stale ${status} bookings:`, error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: `query-stale-${status}` } });
    return;
  }
  if (!stale || stale.length === 0) return;

  // An "editing" booking with an active render_state isn't hung just because
  // processing_started_at is old -- a large 4K render legitimately spans
  // several runs (see driveRender in auto-recap.js). It's only stale if its
  // render_state stopped advancing too (the continue-render process keeps
  // dying), or there's no render_state at all (killed the old way, before
  // this mechanism, or before the first checkpoint landed).
  let candidates = stale;
  if (status === "editing") {
    const { data: dels } = await supabase
      .from("deliverables")
      .select("booking_id, render_state")
      .in("booking_id", stale.map((b) => b.id));
    const byId = new Map((dels || []).map((d) => [d.booking_id, d.render_state]));
    candidates = stale.filter((b) => {
      const rsUpdated = byId.get(b.id)?.updated_at;
      return !rsUpdated || rsUpdated < staleCutoff;
    });
    if (candidates.length === 0) return;
  }

  console.log(`\nFound ${candidates.length} booking(s) stuck in "${status}" for over ${staleHours}h -- recovering...`);
  for (const booking of candidates) {
    // Guarded the same way as the claim above: only revert if it's still
    // in this status right now, so this can't clobber a run that finishes
    // (or gets cancelled) in the moment between the query above and this
    // update.
    const { data: recovered } = await supabase
      .from("bookings")
      .update({ status: "collecting", processing_started_at: null, batch_id: null })
      .eq("id", booking.id)
      .eq("status", status)
      .select("id")
      .maybeSingle();

    if (recovered) {
      console.log(`Recovered booking ${booking.id} (${booking.host_name}) -- reset to "collecting" for retry.`);
      failures.push({
        bookingId: booking.id,
        error: `Stuck in "${status}" for over ${staleHours}h (likely killed by a job timeout mid-run) -- automatically reset to "collecting" and will retry next run.`,
      });
    }
  }
}

async function purgeExpiredUploads(failures) {
  const { data: expired, error } = await supabase
    .from("uploads")
    .select("id, booking_id, storage_key")
    .lte("purge_at", new Date().toISOString())
    .limit(200); // batched -- a single run only needs to make a dent, not clear a backlog in one shot

  if (error) {
    console.error("Failed to query uploads past their purge date:", error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: "query-expired-uploads" } });
    return;
  }
  if (!expired || expired.length === 0) return;

  console.log(`\nPurging ${expired.length} raw upload(s) past their 30-day retention window...`);
  const { deleteFile } = require("../lib/storage");
  for (const upload of expired) {
    try {
      await deleteFile(upload.storage_key);
      await supabase.from("uploads").delete().eq("id", upload.id);
    } catch (err) {
      console.error(`Failed to purge upload ${upload.id}:`, err.message);
      captureError(err, { tags: { script: "poll-and-recap", step: "purge-upload" }, extra: { uploadId: upload.id, bookingId: upload.booking_id } });
      failures.push({ bookingId: upload.booking_id, error: `Raw upload purge failed (upload ${upload.id}): ${err.message}` });
    }
  }
}

async function purgeExpiredGalleries(failures) {
  const { data: expired, error } = await supabase
    .from("bookings")
    .select("id, gallery_purge_at")
    .lte("gallery_purge_at", new Date().toISOString())
    .limit(200); // batched -- a single run only needs to make a dent, not clear a backlog in one shot

  if (error) {
    console.error("Failed to query bookings past their gallery purge date:", error.message);
    captureError(error, { tags: { script: "poll-and-recap", step: "query-expired-galleries" } });
    return;
  }
  if (!expired || expired.length === 0) return;

  console.log(`\nPurging ${expired.length} gallery/video past their retention window...`);
  const { deleteFile, deleteByPrefix } = require("../lib/storage");
  for (const booking of expired) {
    try {
      const { data: deliverables } = await supabase.from("deliverables").select("id, full_video_key, full_video_no_roast_key, full_video_poster_key, full_video_no_roast_poster_key, social_video_key, social_video_keys, social_video_no_roast_keys, social_video_poster_keys, social_video_no_roast_poster_keys, gallery_photo_keys").eq("booking_id", booking.id);
      for (const deliverable of deliverables || []) {
        const keys = [deliverable.full_video_key, deliverable.full_video_no_roast_key, deliverable.full_video_poster_key, deliverable.full_video_no_roast_poster_key, deliverable.social_video_key, ...(deliverable.social_video_keys || []), ...(deliverable.social_video_no_roast_keys || []), ...(deliverable.social_video_poster_keys || []), ...(deliverable.social_video_no_roast_poster_keys || []), ...(deliverable.gallery_photo_keys || [])].filter(Boolean);
        for (const key of keys) {
          await deleteFile(key);
        }
        await supabase.from("deliverables").delete().eq("id", deliverable.id);
      }
      // Backstop for the resumable renderer's scratch area: a render that
      // died in the narrow window between nulling render_state and running
      // its own cleanup would otherwise leave the parked title cards here
      // forever (nothing else scans _render/).
      await deleteByPrefix(`deliverable/${booking.id}/_render/`);
      await supabase.from("bookings").update({ gallery_purge_at: null }).eq("id", booking.id);
    } catch (err) {
      console.error(`Failed to purge gallery for booking ${booking.id}:`, err.message);
      captureError(err, { tags: { script: "poll-and-recap", step: "purge-gallery" }, extra: { bookingId: booking.id } });
      failures.push({ bookingId: booking.id, error: `Gallery purge failed: ${err.message}` });
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for bookings to process...`);
  const failures = [];
  await recoverStaleBookings(failures);
  // Finish existing work before taking on new work, so a run that's tight on
  // its time budget prioritizes deliveries already in flight: advance
  // in-progress 4K renders first, then resume analysis batches, then submit
  // new ones.
  await processRenderingBookings(failures);
  await processAnalyzingBookings(failures);
  await processCollectingBookings(failures);
  await purgeExpiredUploads(failures);
  await purgeExpiredGalleries(failures);

  if (failures.length > 0 && process.env.ADMIN_ALERT_EMAIL) {
    console.log(`Sending failure alert for ${failures.length} booking(s) to ${process.env.ADMIN_ALERT_EMAIL}...`);
    try {
      // Lazy require, same reasoning as the other email sends in this
      // pipeline: constructing the Resend client throws synchronously when
      // RESEND_API_KEY is unset, and a failed alert send shouldn't mask
      // the actual booking failures already logged above.
      const { sendFailureAlert } = require("../lib/email");
      await sendFailureAlert({ to: process.env.ADMIN_ALERT_EMAIL, failures });
    } catch (err) {
      console.error(`Failure alert email itself failed to send: ${err.message}`);
      // The one console.error in this file that most needs an out-of-band
      // monitor: this is the existing alert mechanism breaking, so nothing
      // else in this script will ever surface it.
      captureError(err, { tags: { script: "poll-and-recap", email: "failure-alert" }, extra: { failureCount: failures.length } });
    }
  } else if (failures.length > 0) {
    console.error(`${failures.length} booking(s) failed this run, but ADMIN_ALERT_EMAIL isn't set -- no alert sent.`);
  }

  console.log("Done.");
}

// This process exits right after main() resolves (a GitHub Actions cron job,
// not a long-lived server) -- flushing here gives any captureError() calls
// above a chance to actually finish sending before that happens.
main().finally(() => flushSentry());
