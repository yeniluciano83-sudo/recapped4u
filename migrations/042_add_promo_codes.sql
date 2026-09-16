-- Comp/promo codes -- a booking can skip Stripe entirely by redeeming a
-- code instead of paying, same end state as the existing Free-tier path
-- (pending_confirmation, held until the email owner clicks confirm) but
-- usable on ANY tier. Two intended uses: an unlimited internal pass (no
-- tier_restriction, no max_uses) for the founders to test/use any package
-- repeatedly, and single-use comp codes (max_uses = 1, optionally
-- tier_restriction'd to one package) handed out to select guests.
create table promo_codes (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  label text, -- human note only ("Founders unlimited pass"), never shown to the redeemer
  tier_restriction text check (tier_restriction in ('free', 'standard', 'premium', 'keepsake')), -- null = any tier
  max_uses integer, -- null = unlimited
  use_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table bookings add column if not exists promo_code_used text; -- which code a comped booking redeemed, for admin visibility; null for every ordinary paid/free booking

-- Atomic redeem: the UPDATE's WHERE clause (not a separate SELECT-then-
-- UPDATE) is what makes two near-simultaneous redemptions of the same
-- single-use code race-safe -- Postgres serializes concurrent UPDATEs
-- against the same row, so only one of two racing calls can ever observe
-- use_count still under max_uses and land its increment; the loser's WHERE
-- clause simply matches zero rows. Same reasoning as migration 033's
-- upload-cap trigger, just simpler here since the counter lives directly on
-- the row being redeemed rather than needing a row lock across a separate
-- child-table count.
--
-- Returns the updated row on success, or no rows at all (not an error) for
-- any failure reason -- wrong code, inactive, exhausted, or wrong tier for
-- a tier-restricted code -- so the caller can't distinguish those from the
-- response alone. That's deliberate: a comp code being invalid vs. already
-- used vs. tier-mismatched is all "this code doesn't work for this
-- booking" from the guest's side, and not leaking which reason it was
-- avoids letting someone probe a code's state without redeeming it.
create or replace function redeem_promo_code(p_code text, p_tier text) returns promo_codes
language sql
as $$
  update promo_codes
  set use_count = use_count + 1
  where code = p_code
    and active = true
    and (max_uses is null or use_count < max_uses)
    and (tier_restriction is null or tier_restriction = p_tier)
  returning *;
$$;
