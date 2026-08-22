-- A real message thread per custom inquiry, fed by both directions:
-- outbound rows are written when staff send a message/quote from the
-- dashboard; inbound rows are written by the Resend inbound webhook
-- (app/api/webhooks/resend-inbound) when a host (or staff, replying from
-- their own inbox) replies to the per-inquiry address. This is what lets
-- host replies show up in the dashboard automatically instead of only
-- landing in a personal inbox.
create table custom_inquiry_messages (
  id uuid primary key default uuid_generate_v4(),
  inquiry_id uuid not null references custom_inquiries(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  created_at timestamptz not null default now()
);

create index custom_inquiry_messages_inquiry_id_idx on custom_inquiry_messages(inquiry_id);

alter table custom_inquiry_messages enable row level security;
