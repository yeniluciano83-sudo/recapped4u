-- Free tier's finished gallery/video had no deletion cutoff at all -- once
-- delivered it stayed downloadable forever. Set on delivery for Free
-- bookings only (delivered_at + 30 days); the scheduler deletes the
-- deliverable's R2 objects and row once this passes.
alter table bookings add column gallery_purge_at timestamptz;
