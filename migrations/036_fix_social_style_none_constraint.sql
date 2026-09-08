-- "No theme (no music)" is a real, offered choice for social_style
-- (app/booking/page.jsx's SOCIAL_STYLE_OPTIONS, stored as the literal string
-- 'none' -- see resolveSocialPhotoStyle in lib/socialPhotoStyle.js and
-- booking.social_style === "none" in scripts/auto-recap.js), but migration
-- 005's check constraint was only ever set up for the 5 real styles. Any
-- Spotlight/Luxe host picking it could never complete their booking at all
-- -- confirmed live: inserting social_style: 'none' violated this exact
-- constraint (code 23514) against the real database.
alter table bookings drop constraint if exists bookings_social_style_check;
alter table bookings add constraint bookings_social_style_check
  check (social_style in ('cinematic', 'upbeat', 'documentary', 'retro', 'highlight', 'none'));
