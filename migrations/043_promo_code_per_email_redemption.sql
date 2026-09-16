-- The comp code (migration 042) was designed as one-use-EVER: the first
-- person to redeem it exhausts it for everyone. The actual want turned
-- out to be one-use-PER-PERSON -- the same code handed to many select
-- guests, each of whom can only redeem it once. That needs tracking WHO
-- redeemed it, not just a running total.
create table promo_code_redemptions (
  code text not null,
  email text not null, -- always stored lowercased; the function below lowercases before insert/lookup
  booking_id uuid references bookings(id) on delete set null, -- kept even if the booking is later deleted, so the redemption itself still counts
  redeemed_at timestamptz not null default now(),
  primary key (code, email) -- the actual enforcement: one row per (code, redeemer) pair, ever
);

-- Replaces the migration-042 version. Still enforces the code's own
-- active/tier_restriction/max_uses (an optional overall cap across ALL
-- redeemers, independent of the new per-email limit -- null max_uses means
-- no such cap, which is what the existing comp code is being switched to
-- below), and now ALSO requires this specific email hasn't redeemed this
-- code before.
--
-- plpgsql + an explicit `for update` row lock, not the single atomic
-- UPDATE migration 042 used -- that trick worked when there was only one
-- piece of state to check-and-update (use_count on the same row), but two
-- related pieces of state now have to move together (use_count on
-- promo_codes, and a new row in promo_code_redemptions), so this needs a
-- real transaction with the code row locked for its duration. Same
-- reasoning as migration 033's upload-cap trigger: the lock is what makes
-- two near-simultaneous redemptions (of the SAME code, by DIFFERENT
-- emails, or even the same email racing itself) resolve safely instead of
-- both reading state that's about to be invalidated by the other.
create or replace function redeem_promo_code(p_code text, p_tier text, p_email text) returns promo_codes
language plpgsql
as $$
declare
  v_row promo_codes;
  v_empty promo_codes;
  v_email text := lower(p_email);
begin
  select * into v_row from promo_codes where code = p_code for update;

  if v_row.code is null
     or not v_row.active
     or (v_row.tier_restriction is not null and v_row.tier_restriction != p_tier)
     or (v_row.max_uses is not null and v_row.use_count >= v_row.max_uses)
  then
    return v_empty; -- same "every column null" failure shape as migration 042 -- see its own comment for why that's deliberate
  end if;

  if exists (select 1 from promo_code_redemptions where code = p_code and email = v_email) then
    return v_empty; -- this email already used this code -- the only NEW rejection reason vs. migration 042
  end if;

  insert into promo_code_redemptions (code, email) values (p_code, v_email);

  update promo_codes set use_count = use_count + 1 where code = p_code returning * into v_row;

  return v_row;
end;
$$;

-- The comp code was inserted with max_uses = 1 under the old one-use-EVER
-- design. Per-email redemption tracking is now the actual limit on any
-- one person, so the overall cap is lifted -- otherwise the very first
-- redeemer would still exhaust it for everyone else, defeating the whole
-- point of this migration. Scoped to this one code by its literal value
-- (not e.g. "every row"), since a future code might deliberately want a
-- real overall cap alongside the per-email limit.
update promo_codes set max_uses = null where code = 'L5W8CD5VMB';
