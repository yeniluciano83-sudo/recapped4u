-- Guest RSVPs (yes/no/maybe) for a booking, submitted from the guest-facing
-- event page (app/event/[eventId]/page.jsx) and summarized for the host on
-- their QR/share page (app/qr/[slug]/page.jsx) -- see
-- app/api/events/[eventId]/rsvp/route.js.
create table if not exists rsvps (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  guest_name text,
  response text not null check (response in ('yes', 'no', 'maybe')),
  created_at timestamptz not null default now()
);

create index if not exists rsvps_booking_id_idx on rsvps(booking_id);

-- Lets a named guest change their mind (re-tapping Yes/Maybe/No) update
-- their existing response instead of piling up duplicate rows -- see the
-- upsert in app/api/events/[eventId]/rsvp/route.js. Anonymous ("Guest")
-- responses have no identity to dedupe against and are excluded (NULL or
-- empty guest_name), same reasoning uploads never dedupe anonymous names.
create unique index if not exists rsvps_booking_guest_unique
  on rsvps (booking_id, guest_name)
  where guest_name is not null and guest_name <> '';
