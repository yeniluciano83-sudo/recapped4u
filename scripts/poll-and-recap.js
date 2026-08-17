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
 *   3. Finds bookings paused at "awaiting_roast_approval" whose script has
 *      since been approved, and resumes them to finish rendering.
 *   4. Permanently deletes raw guest uploads whose purge_at (set to 30 days
 *      after delivery, see finalizeDelivery in auto-recap.js) has passed --
 *      matching the retention policy already promised in the UI copy.
 *   5. Permanently deletes Free-tier bookings' finished gallery/video (R2
 *      objects + the deliverables row) whose gallery_purge_at (set to 7
 *      days after delivery) has passed -- unlike paid tiers, Free has no
 *      revenue backing indefinite storage.
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
        });
        await supabase.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", booking.id);
      } catch (err) {
        console.error(`Reminder email failed for booking ${booking.id}: ${err.message}`);
      }
    }
  }
}

async function resumeApprovedRoastBookings(failures) {
  const { data: bookings, error } = await supabase.from("bookings").select("id").eq("status", "awaiting_roast_approval");
  if (error) {
    console.error("Failed to query awaiting-approval bookings:", error.message);
    return;
  }

  for (const booking of bookings || []) {
    const { data: script } = await supabase
      .from("roast_scripts")
      .select("status")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (script?.status === "approved") {
      console.log(`\nResuming approved booking ${booking.id}...`);
      try {
        runRecap(booking.id);
      } catch (err) {
        console.error(`Booking ${booking.id} failed:`, err.message);
        failures.push({ bookingId: booking.id, error: err.message });
      }
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

async function purgeExpiredFreeGalleries(failures) {
  const { data: expired, error } = await supabase
    .from("bookings")
    .select("id, gallery_purge_at")
    .eq("tier", "free")
    .lte("gallery_purge_at", new Date().toISOString())
    .limit(200); // batched -- a single run only needs to make a dent, not clear a backlog in one shot

  if (error) {
    console.error("Failed to query free bookings past their gallery purge date:", error.message);
    return;
  }
  if (!expired || expired.length === 0) return;

  console.log(`\nPurging ${expired.length} Free-tier gallery/video past their 30-day retention window...`);
  const { deleteFile } = require("../lib/storage");
  for (const booking of expired) {
    try {
      const { data: deliverables } = await supabase.from("deliverables").select("id, full_video_key, social_video_key, gallery_photo_keys").eq("booking_id", booking.id);
      for (const deliverable of deliverables || []) {
        const keys = [deliverable.full_video_key, deliverable.social_video_key, ...(deliverable.gallery_photo_keys || [])].filter(Boolean);
        for (const key of keys) {
          await deleteFile(key);
        }
        await supabase.from("deliverables").delete().eq("id", deliverable.id);
      }
      await supabase.from("bookings").update({ gallery_purge_at: null }).eq("id", booking.id);
    } catch (err) {
      console.error(`Failed to purge gallery for booking ${booking.id}:`, err.message);
      failures.push({ bookingId: booking.id, error: `Free gallery purge failed: ${err.message}` });
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for bookings to process...`);
  const failures = [];
  await processCollectingBookings(failures);
  await resumeApprovedRoastBookings(failures);
  await purgeExpiredUploads(failures);
  await purgeExpiredFreeGalleries(failures);

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
