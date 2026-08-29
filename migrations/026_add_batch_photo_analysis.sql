-- Two-phase photo analysis: every uploaded photo now goes through the
-- Claude Batch API (50% cheaper than the old one-call-per-photo path, see
-- analyzePhoto in scripts/auto-recap.js) instead of a blocking synchronous
-- call. Batches routinely take under an hour to finish but carry no faster
-- guarantee, far longer than the 20-minute window poll-and-recap.js's cron
-- job has to run in (see .github/workflows/recap-scheduler.yml) -- so
-- submitting and waiting can no longer happen inside one run.
--
-- 'analyzing' is the new intermediate status a booking sits in while its
-- batch is in flight, checked again on each later poll-and-recap.js tick.
-- 'editing' keeps its existing meaning unchanged (actively running
-- enhancement/video assembly, expected to finish in minutes) -- it's only
-- entered once analysis results are in hand, whether from a finished batch
-- or the synchronous fallback path used when a batch runs long.
alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('booked', 'pending_confirmation', 'collecting', 'analyzing', 'editing', 'awaiting_roast_approval', 'delivered', 'cancelled'));

-- The in-flight Claude Message Batch id for a booking currently 'analyzing';
-- cleared once resolved (results retrieved, or the fallback in
-- lib/batchAnalysis.js gives up and switches to the old synchronous
-- per-photo calls). Lets a later poll-and-recap.js run pick the same batch
-- back up instead of resubmitting and paying for the photos twice.
alter table bookings add column batch_id text;
