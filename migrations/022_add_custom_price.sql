-- Bookings created via the staff custom-quote tool (app/api/admin/custom-quote)
-- still need a real `tier` (drives upload limits, gallery retention, Roast
-- Reel/social-cut eligibility -- see lib/pricing.js), but the amount actually
-- charged doesn't match that tier's fixed TIER_PRICES price. Nullable: every
-- normal booking leaves this null and the dashboard falls back to the tier's
-- standard price display.
alter table bookings add column custom_price_cents integer;
