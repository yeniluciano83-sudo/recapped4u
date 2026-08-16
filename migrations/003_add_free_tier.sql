alter table bookings drop constraint if exists bookings_tier_check;
alter table bookings add constraint bookings_tier_check
  check (tier in ('free', 'standard', 'premium', 'keepsake'));
