-- Adds a self-serve cancellation flow: hosts can cancel from a link in their
-- booking confirmation email. 'cancelled' becomes a valid booking status,
-- and cancelled_at records when it happened.

alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('booked', 'collecting', 'editing', 'awaiting_roast_approval', 'delivered', 'cancelled'));

alter table bookings add column cancelled_at timestamptz;
