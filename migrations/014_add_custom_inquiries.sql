-- Custom package inquiries: submitted before any booking/price exists, so
-- they can't live in `bookings` (which requires a tier and drives the
-- pipeline). Tracks the negotiation from initial ask through quote through
-- payment, instead of the inquiry only ever existing as an email that goes
-- stale the moment it's archived.
create table custom_inquiries (
  id uuid primary key default uuid_generate_v4(),
  host_name text not null,
  email text not null,
  event_type text not null,
  event_date date not null,
  guest_count integer,
  style text,
  notes text, -- the host's original "what we need" message
  status text not null default 'new' check (status in ('new', 'quoted', 'accepted', 'declined')),
  -- The base tier a quote borrows its pipeline rules from (upload deadline,
  -- gallery retention, Roast Reel/social-cut eligibility) -- custom pricing
  -- doesn't need custom pipeline logic duplicated everywhere else.
  quoted_tier text check (quoted_tier in ('standard', 'premium', 'keepsake')),
  quoted_price_cents integer,
  quote_message text, -- the business's reply/pitch shown alongside the price
  booking_id uuid references bookings(id), -- set once the host accepts and a real booking is created
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index custom_inquiries_status_idx on custom_inquiries(status);

alter table custom_inquiries enable row level security;
