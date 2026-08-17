-- Lets a Luxe host push their upload deadline out by a fixed 48 hours,
-- once, via the QR share page. 0 = not used yet.
alter table bookings add column deadline_extension_hours integer not null default 0;
