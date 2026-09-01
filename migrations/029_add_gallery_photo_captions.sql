-- Every gallery photo already gets a Claude-generated moment_type during
-- analysis (used for shortlisting, and since this session's Highlight Reel
-- work, for on-screen video callouts too) -- this persists a short,
-- gallery-friendly version of it per photo so the gallery page can show a
-- caption instead of a bare grid of images. Parallel to gallery_photo_keys
-- (same array, same order, same table) -- see schema.sql:81.
alter table deliverables add column gallery_photo_captions text[];
