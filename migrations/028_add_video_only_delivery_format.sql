-- Spotlight/Luxe previously had only two delivery choices: "recap" (full
-- video + social cuts, bundled together) or "social_cuts" (no full video,
-- cuts only). There was no way to get just the full video with zero social
-- cuts. Postgres check constraints can't be altered in place, so this drops
-- and recreates it with the new value added.
alter table bookings drop constraint bookings_delivery_format_check;
alter table bookings add constraint bookings_delivery_format_check check (delivery_format in ('recap', 'video_only', 'social_cuts'));
