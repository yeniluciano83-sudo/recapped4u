-- Fixes a real bug in every named-guest RSVP: app/api/events/[eventId]/rsvp
-- upserts with `ON CONFLICT (booking_id, guest_name)`, but migration 038's
-- unique index is PARTIAL (`where guest_name is not null and guest_name <>
-- ''`) -- Postgres only accepts a partial index as an ON CONFLICT arbiter
-- when the ON CONFLICT clause repeats that exact WHERE predicate, which the
-- Supabase JS client's `.upsert(..., { onConflict })` has no way to
-- express. Every named RSVP has been failing with a 500 ("42P10: there is
-- no unique or exclusion constraint matching the ON CONFLICT specification"),
-- confirmed live against this project's own database.
--
-- Fix: drop the partial index and replace it with a plain unique index on
-- the same two columns. This changes nothing about the actual data: the
-- app only ever upserts against this index when guest_name is a trimmed,
-- non-empty string (see the route's own trimmedName branch), and only
-- ever inserts guest_name as literal NULL on the anonymous path (never
-- ''), and Postgres unique indexes already treat NULL as distinct from
-- every other NULL -- so anonymous RSVPs still never collide, without
-- needing the partial predicate to say so.
drop index if exists rsvps_booking_guest_unique;

create unique index if not exists rsvps_booking_guest_unique
  on rsvps (booking_id, guest_name);
