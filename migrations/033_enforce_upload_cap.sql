-- The per-event upload cap was advisory, not enforced.
--
-- presign/route.js read the current count, compared it to getUploadLimit(tier)
-- and issued a URL if there was room; confirm/route.js then inserted with no
-- check at all. Classic read-then-write race: concurrent presigns all observe
-- the same count, all pass, and all upload. The rate limit doesn't contain it
-- either -- that budget is 600/min precisely because a room full of guests on
-- one shared Wi-Fi NATs out through a single IP, so it's far too loose to act
-- as a cap.
--
-- That matters because this cap is the entire defence against a guessed or
-- leaked event link scripting uploads forever (see lib/uploadLimits.js): every
-- object over it is R2 storage and Claude analysis billed to us.
--
-- Enforced here rather than in the route because this is the only layer that
-- can do it atomically. `FOR UPDATE` on the booking row serialises concurrent
-- inserts for one event, so the count below is taken while no other insert for
-- that booking can commit. Uploads for *different* bookings are unaffected --
-- they lock different rows -- and real upload rates are ~1/sec per event, so
-- the serialisation costs nothing observable.
--
-- Purely additive: until this is applied, behaviour is exactly as before, so
-- it can't break a deploy that ships ahead of it.
create or replace function enforce_upload_cap() returns trigger
language plpgsql
as $$
declare
  v_tier  text;
  v_cap   integer;
  v_count integer;
begin
  -- FOR UPDATE is the whole point: it serialises confirms for this booking.
  -- Without it two transactions both read count = cap - 1 and both insert.
  select tier into v_tier from bookings where id = new.booking_id for update;

  -- No booking is a foreign-key problem, not a cap problem -- let the FK
  -- constraint produce its own, clearer error.
  if v_tier is null then
    return new;
  end if;

  -- MUST match MAX_UPLOADS_PER_EVENT / DEFAULT_MAX_UPLOADS_PER_EVENT in
  -- lib/uploadLimits.js. Duplicated deliberately: the route needs the number
  -- to reject early without a round trip, and the database needs it to be the
  -- one that's actually true. lib/uploadLimits.test.js asserts they agree.
  v_cap := case v_tier
             when 'free'     then 20
             when 'standard' then 500
             when 'premium'  then 2000
             when 'keepsake' then 2000
             else 500
           end;

  select count(*) into v_count from uploads where booking_id = new.booking_id;

  if v_count >= v_cap then
    -- Custom SQLSTATE so the route can tell "cap reached" (a 400 the guest
    -- should see worded kindly) apart from a genuine insert failure (a 500).
    raise exception 'upload cap of % reached for booking %', v_cap, new.booking_id
      using errcode = 'UPCAP';
  end if;

  return new;
end;
$$;

drop trigger if exists uploads_enforce_cap on uploads;
create trigger uploads_enforce_cap
  before insert on uploads
  for each row
  execute function enforce_upload_cap();
