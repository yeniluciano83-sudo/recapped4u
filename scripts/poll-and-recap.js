/**
 * Recapped For You — Scheduled recap runner
 * -------------------------------------------
 * Meant to run on a schedule (see .github/workflows/recap-scheduler.yml).
 * Each run:
 *
 *   1. Finds bookings still "collecting" whose event was >= that tier's
 *      upload deadline ago (see TIER_SCHEDULE) -- or whose host has
 *      manually closed uploads early via the QR share page -- and runs
 *      the full auto-recap pipeline for them.
 *   2. Finds bookings still "collecting" past that tier's reminder
 *      threshold (but before the deadline), with no reminder sent yet,
 *      and emails the host a heads-up that processing starts soon.
 *   3. Permanently deletes raw guest uploads whose purge_at (set to 30 days
 *      after delivery, see finalizeDelivery in auto-recap.js) has passed --
 *      matching the retention policy already promised in the UI copy.
 *   4. Permanently deletes any booking's finished gallery/video (R2 objects
 *      + the deliverables row) whose gallery_purge_at (set to each tier's
 *      retention window after delivery -- 7 days Free, 2/4/6 months
 *      Classic/Signature/Luxe) has passed, matching the retention policy
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
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const path = require("path");
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Free's deadline is deliberately tight (encourages upgrading for more
// time) and skips a reminder entirely -- a same-day heads-up doesn't fit a
// 24h window. Classic keeps the original 48h/24h pairing. Signature gets a
// week (reminder a day before). Luxe gets two weeks, reminded after the
// first week.
const TIER_SCHEDULE = {
  free: { processHours: 24, reminderHours: null },
  standard: { processHours: 48, reminderHours: 24 },
  premium: { processHours: 24 * 7, reminderHours: 24 * 6 },
  keepsake: { processHours: 24 * 14, reminderHours: 24 * 7 },
};

function hoursSinceEvent(eventDate) {
  return (Date.now() - new Date(eventDate).getTime()) / (1000 * 60 * 60);
}

function runRecap(bookingId) {
  execSync(`node "${path.join(__dirname, "auto-recap.js")}" ${bookingId}`, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
}

async function processCollectingBookings(failures) {
  const { data: bookings, error } = await supabase.from("bookings").select("*").eq("status", "collecting");
  if (error) {
    console.error("Failed to query collecting bookings:", error.message);
    return;
  }

  for (const booking of bookings || []) {
    const schedule = TIER_SCHEDULE[booking.tier];
    if (!schedule) {
      console.error(`Booking ${booking.id} has unrecognized tier "${booking.tier}" -- skipping.`);
      continue;
    }

    const hours = hoursSinceEvent(booking.event_date);
    const closedEarly = Boolean(booking.uploads_closed_at);
    const extensionHours = booking.deadline_extension_hours || 0;
    const effectiveProcessHours = schedule.processHours + extensionHours;

    if (hours >= effectiveProcessHours || closedEarly) {
      // Atomic claim: this run and an overlapping one (e.g. a manual
      // workflow_dispatch landing near the top of the hour, next to the
      // cron tick) could otherwise both see this booking as "collecting"
      // from their own initial query and both process it, generating
      // duplicate roast scripts/emails. The conditional .eq("status",
      // "collecting") means only one run's UPDATE actually matches a row.
      const { data: claimed } = await supabase
        .from("bookings")
        .update({ status: "editing", processing_started_at: new Date().toISOString() })
        .eq("id", booking.id)
        .eq("status", "collecting")
        .select("id")
        .maybeSingle();

      if (!claimed) {
        console.log(`\nBooking ${booking.id} was already claimed by another run -- skipping.`);
        continue;
      }

      const reason = closedEarly ? "host closed uploads early" : `event was ~${Math.round(hours)}h ago`;
      console.log(`\nProcessing booking ${booking.id} (${booking.tier}, ${reason})...`);
      try {
        runRecap(booking.id);
      } catch (err) {
        console.error(`Booking ${booking.id} failed:`, err.message);
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
      }
    }
  }
}

// A real run (photo analysis + video encoding for a handful of bookings)
// finishes in minutes. If a booking is still "editing" after this long, the
// process that claimed it was killed before reaching runAutoRecap's own
// catch block (job timeout -- see the 20-minute limit in
// .github/workflows/recap-scheduler.yml -- OOM, or a crash) and never
// reverted itself. Left alone, that booking is invisible forever: this
// query is the only thing that ever looks at status = "editing" again.
const STALE_EDITING_HOURS = 1.5;

async function recoverStaleEditingBookings(failures) {
  const staleCutoff = new Date(Date.now() - STALE_EDITING_HOURS * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await supabase
    .from("bookings")
    .select("id, host_name, processing_started_at")
    .eq("status", "editing")
    .lt("processing_started_at", staleCutoff);

  if (error) {
    console.error("Failed to query stale editing bookings:", error.message);
    return;
  }
  if (!stale || stale.length === 0) return;

  console.log(`\nFound ${stale.length} booking(s) stuck in "editing" for over ${STALE_EDITING_HOURS}h -- recovering...`);
  for (const booking of stale) {
    // Guarded the same way as the claim above: only revert if it's still
    // "editing" right now, so this can't clobber a run that finishes (or
    // gets cancelled) in the moment between the query above and this update.
    const { data: recovered } = await supabase
      .from("bookings")
      .update({ status: "collecting", processing_started_at: null })
      .eq("id", booking.id)
      .eq("status", "editing")
      .select("id")
      .maybeSingle();

    if (recovered) {
      console.log(`Recovered booking ${booking.id} (${booking.host_name}) -- reset to "collecting" for retry.`);
      failures.push({
        bookingId: booking.id,
        error: `Stuck in "editing" for over ${STALE_EDITING_HOURS}h (likely killed by a job timeout mid-run) -- automatically reset to "collecting" and will retry next run.`,
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
    return;
  }
  if (!expired || expired.length === 0) return;

  console.log(`\nPurging ${expired.length} gallery/video past their retention window...`);
  const { deleteFile } = require("../lib/storage");
  for (const booking of expired) {
    try {
      const { data: deliverables } = await supabase.from("deliverables").select("id, full_video_key, full_video_no_roast_key, social_video_key, social_video_keys, gallery_photo_keys").eq("booking_id", booking.id);
      for (const deliverable of deliverables || []) {
        const keys = [deliverable.full_video_key, deliverable.full_video_no_roast_key, deliverable.social_video_key, ...(deliverable.social_video_keys || []), ...(deliverable.gallery_photo_keys || [])].filter(Boolean);
        for (const key of keys) {
          await deleteFile(key);
        }
        await supabase.from("deliverables").delete().eq("id", deliverable.id);
      }
      await supabase.from("bookings").update({ gallery_purge_at: null }).eq("id", booking.id);
    } catch (err) {
      console.error(`Failed to purge gallery for booking ${booking.id}:`, err.message);
      failures.push({ bookingId: booking.id, error: `Gallery purge failed: ${err.message}` });
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for bookings to process...`);
  const failures = [];
  await recoverStaleEditingBookings(failures);
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
    }
  } else if (failures.length > 0) {
    console.error(`${failures.length} booking(s) failed this run, but ADMIN_ALERT_EMAIL isn't set -- no alert sent.`);
  }

  console.log("Done.");
}

main();
