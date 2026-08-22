-- Free-tier bookings have always been set to 'pending_confirmation' while
-- waiting on the host to click the confirm-booking email link (see
-- app/api/bookings/route.js and app/api/bookings/[id]/confirm/route.js),
-- but that status was never added to this constraint. Every free booking's
-- update to 'pending_confirmation' has been silently failing the check
-- constraint and staying on 'booked' -- so clicking "Confirm this booking"
-- has always seen a status that isn't 'pending_confirmation', assumed it
-- was already confirmed, and skipped activating the guest upload link.

alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('booked', 'pending_confirmation', 'collecting', 'editing', 'awaiting_roast_approval', 'delivered', 'cancelled'));
