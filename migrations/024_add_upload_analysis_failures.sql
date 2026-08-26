-- Per-photo analysis failures during auto-recap.js's Claude Vision pass
-- (an R2 download error, a Claude API error, etc.) previously vanished
-- into that run's ephemeral GitHub Actions console output -- a photo would
-- just silently disappear from both the gallery and the video with no
-- queryable record of why. Recorded here instead so a booking with fewer
-- gallery photos than raw uploads is actually diagnosable after the fact
-- (see app/dashboard/page.jsx and app/api/bookings/[id]/analysis-failures).
create table upload_analysis_failures (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  -- set null (not cascaded) so the failure record survives the raw
  -- upload's normal 30-day purge (see scripts/poll-and-recap.js) --
  -- storage_key below is kept regardless, for reference.
  upload_id uuid references uploads(id) on delete set null,
  storage_key text not null,
  error_message text not null,
  created_at timestamptz not null default now()
);

create index upload_analysis_failures_booking_id_idx on upload_analysis_failures(booking_id);

alter table upload_analysis_failures enable row level security;
