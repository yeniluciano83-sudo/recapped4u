-- gallery_template's DB-level default was "grid" (schema.sql) -- every real
-- booking insert already sets this explicitly via defaultGalleryTemplate()
-- in lib/pricing.js, which now unconditionally returns "polaroid", but the
-- column-level default is the backstop for anything that ever inserts a
-- booking without going through that (a manual SQL insert, a future code
-- path that forgets to set it). Belt and suspenders: keeps both sources of
-- truth pointed at the same value instead of one silently drifting from
-- the other.
alter table bookings alter column gallery_template set default 'polaroid';
