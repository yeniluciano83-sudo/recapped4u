-- A run killed mid-pipeline (job timeout, OOM, crash) never reaches the
-- catch block in scripts/auto-recap.js that reverts status back to
-- "collecting" -- the booking is left at "editing" forever, invisible to
-- poll-and-recap.js (which only ever re-queries status = "collecting").
-- Set when status flips to "editing", cleared on revert/delivery, so the
-- scheduler can detect a stale claim and recover it automatically.
alter table bookings add column if not exists processing_started_at timestamptz;
