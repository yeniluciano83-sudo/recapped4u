-- Adds Roast Reel script-approval support.
-- Run this once in the Supabase SQL editor for the recapped4u project.

alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('booked', 'collecting', 'editing', 'awaiting_roast_approval', 'delivered'));

-- Draft Roast Reel scripts awaiting host review, separate from `deliverables`
-- (the final, already-approved/rendered assets).
create table roast_scripts (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  script jsonb not null, -- [{ photo_index, storage_key, line }]
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create index roast_scripts_booking_id_idx on roast_scripts(booking_id);

alter table roast_scripts enable row level security;
