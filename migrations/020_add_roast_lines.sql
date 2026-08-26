-- Flat log of every individual Roast Reel line ever generated, used to feed
-- recent-joke-history context into future generateRoastScript prompts (see
-- lib/roast.js) so the model can steer away from repeating a similar joke
-- angle it already used -- for a different booking, or for an earlier cut
-- within the same booking (each social cut is its own generateRoastScript
-- call with no shared context otherwise). Deliberately a new table rather
-- than reusing roast_scripts: that one's shaped around an abandoned
-- host-approval workflow (status/approved_at) this doesn't need.
create table roast_lines (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  event_type text not null,
  roast_level text not null,
  line text not null,
  created_at timestamptz not null default now()
);

create index roast_lines_created_at_idx on roast_lines(created_at desc);
