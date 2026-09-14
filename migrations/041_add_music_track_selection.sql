-- Lets a host pick which track (not just which style) plays under their
-- video/social cut, now that public/music/<style>/ holds several candidate
-- tracks instead of one. 1-based index into that style's track list;
-- defaults to 1 so every existing booking keeps its current track-1.mp3
-- exactly as before this existed. Not range-constrained here -- styles have
-- different track counts, and that count changes as tracks are added or
-- removed -- scripts/auto-recap.js's resolveMusicSelection (lib/musicTrack.js)
-- clamps an out-of-range value back to track 1 instead.
alter table bookings add column if not exists music_track integer not null default 1;
alter table bookings add column if not exists social_music_track integer not null default 1;
