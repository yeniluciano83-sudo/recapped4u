-- Multi-day support for custom-quoted bookings (app/api/admin/custom-quote)
-- only -- the standard tiers/booking flow are still single-day, so this is
-- nullable and every other insert path leaves it unset. Purely descriptive:
-- upload deadlines, reminder emails, and gallery retention still key off
-- `event_date` (the start) exactly as before.
alter table bookings add column event_end_date date;
