-- Recapped For You — Supabase schema
-- Run this in the Supabase SQL editor after creating your project.

create extension if not exists "uuid-ossp";

-- One row per client booking / event
create table bookings (
  id uuid primary key default uuid_generate_v4(),
  host_name text not null,
  email text not null,
  event_type text not null,
  event_date date not null,
  guest_count integer,
  tier text not null check (tier in ('free', 'standard', 'premium', 'keepsake')),
  style text check (style in ('cinematic', 'upbeat', 'documentary', 'retro', 'highlight')),
  social_style text check (social_style in ('cinematic', 'upbeat', 'documentary', 'retro', 'highlight')), -- optional separate theme for the social cut (Signature/Luxe only); falls back to `style` if unset
  notes text,
  status text not null default 'booked'
    check (status in ('booked', 'pending_confirmation', 'collecting', 'editing', 'awaiting_roast_approval', 'delivered', 'cancelled')),
  stripe_payment_status text default 'unpaid'
    check (stripe_payment_status in ('unpaid', 'paid', 'refunded')),
  stripe_session_id text,
  upload_slug text unique not null, -- used to build the public guest-upload URL
  delivered_at timestamptz,
  gallery_expires_at timestamptz, -- delivered_at + per-tier retention (see GALLERY_EXPIRY_MONTHS/DAYS in scripts/auto-recap.js), set on delivery
  roast_enabled boolean not null default false,
  roast_level text check (roast_level in ('light', 'lukewarm', 'hot')),
  delivery_format text not null default 'recap' check (delivery_format in ('recap', 'social_cuts')), -- Signature/Luxe only: 'social_cuts' skips the curated full video for as many social cuts as it takes to cover every uploaded photo
  full_video_no_music boolean not null default false, -- skip the style's soundtrack on the full recap video specifically (social cuts keep theirs)
  gallery_template text not null default 'grid' check (gallery_template in ('grid', 'masonry', 'slideshow', 'polaroid')),
  reminder_sent_at timestamptz, -- set when the 24h-post-event upload reminder email is sent
  uploads_closed_at timestamptz, -- set when the host signals guests are done uploading, ahead of the tier's deadline
  cancelled_at timestamptz, -- set when the host cancels via their self-serve cancellation link
  created_at timestamptz not null default now()
);

-- One row per guest-uploaded file, linked to a booking
create table uploads (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  uploader_name text,
  storage_key text not null, -- path in R2/S3
  file_type text check (file_type in ('photo', 'video')),
  must_include_social boolean not null default false, -- host-flagged "must appear in the social cut" (Signature/Luxe)
  uploaded_at timestamptz not null default now(),
  purge_at timestamptz -- set to uploaded_at + 30 days after delivery, for cleanup job
);

-- One row per photo analyzed by the curation pipeline
create table photo_analysis (
  id uuid primary key default uuid_generate_v4(),
  upload_id uuid not null references uploads(id) on delete cascade,
  technical_quality integer check (technical_quality between 1 and 10),
  emotional_strength integer check (emotional_strength between 1 and 10),
  moment_type text,
  has_faces boolean,
  notes text,
  analyzed_at timestamptz not null default now()
);

-- One row per event's generated story arc / curation report
create table curation_reports (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  shortlist_upload_ids uuid[],
  story_arc jsonb, -- the {section, files, note} structure from curate.js
  title_card_text text,
  closing_card_text text,
  generated_at timestamptz not null default now()
);

-- Final delivered assets (video cuts, gallery link)
create table deliverables (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  full_video_key text,
  full_video_no_roast_key text, -- caption-free twin of full_video_key, only set for Roast Reel bookings
  social_video_key text, -- kept in sync with social_video_keys[0] for backward compatibility
  social_video_keys text[], -- Luxe gets multiple cuts; Signature/Free get at most 1
  gallery_photo_keys text[],
  delivered_at timestamptz not null default now()
);

-- Draft Roast Reel scripts awaiting host review, separate from `deliverables`
-- (the final, already-approved/rendered assets). Currently unused: the app
-- never writes to this table or sets a booking to 'awaiting_roast_approval'
-- -- Roast Reel scripts are generated and rendered directly (see lib/roast.js),
-- with a prompt-level safety rule as the only guardrail instead of a host
-- review step. Left in place as scaffolding in case that changes later.
create table roast_scripts (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references bookings(id) on delete cascade,
  script jsonb not null, -- [{ photo_index, storage_key, line }]
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

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

-- A real message thread per custom inquiry, fed by both directions:
-- outbound rows are written when staff send a message/quote from the
-- dashboard; inbound rows are written by the Resend inbound webhook
-- (app/api/webhooks/resend-inbound) when a host (or staff, replying from
-- their own inbox) replies to the per-inquiry address.
create table custom_inquiry_messages (
  id uuid primary key default uuid_generate_v4(),
  inquiry_id uuid not null references custom_inquiries(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  created_at timestamptz not null default now()
);

-- Helpful index for the dashboard's default sort/filter
create index bookings_status_idx on bookings(status);
create index bookings_event_date_idx on bookings(event_date);
create index uploads_booking_id_idx on uploads(booking_id);
create index roast_scripts_booking_id_idx on roast_scripts(booking_id);
create index custom_inquiries_status_idx on custom_inquiries(status);
create index custom_inquiry_messages_inquiry_id_idx on custom_inquiry_messages(inquiry_id);

-- Row Level Security: lock everything down by default.
-- The app will use the Supabase service role key on the server side,
-- which bypasses RLS — this just prevents public/anon access to raw tables.
alter table bookings enable row level security;
alter table uploads enable row level security;
alter table photo_analysis enable row level security;
alter table curation_reports enable row level security;
alter table deliverables enable row level security;
alter table roast_scripts enable row level security;
alter table custom_inquiries enable row level security;
alter table custom_inquiry_messages enable row level security;
