-- Tracks whether the host has already been emailed that this event hit its
-- tier's upload cap (lib/uploadLimits.js -- 20/500/2000/2000), so the
-- notification fires exactly once per "fill" rather than once per guest
-- who gets turned away afterward.
--
-- Nullable and reset back to null on a successful delete (see the DELETE
-- handler on app/api/events/[eventId]/uploads/[uploadId]/route.js) -- a host
-- who deletes photos to free room and later re-fills the event should get
-- notified again, not be silenced forever after the first time.
alter table bookings add column upload_cap_notified_at timestamptz;
