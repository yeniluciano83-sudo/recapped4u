-- The style constraint only ever allowed 3 of the 5 styles the booking
-- form actually offers -- selecting "Nostalgic / Retro" or "Highlight
-- Reel" would fail the booking insert. Fixing that here alongside adding
-- social_style, which needs the same full list.
alter table bookings drop constraint if exists bookings_style_check;
alter table bookings add constraint bookings_style_check
  check (style in ('cinematic', 'upbeat', 'documentary', 'retro', 'highlight'));

alter table bookings add column if not exists social_style text
  check (social_style in ('cinematic', 'upbeat', 'documentary', 'retro', 'highlight'));
