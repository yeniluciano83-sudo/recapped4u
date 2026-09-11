-- Backs the shareable guest invite (app/api/invite/[bookingId]/route.js):
-- until now bookings only ever captured event *type* and *date* -- no
-- venue/location or start time -- so there was nothing to show guests
-- beyond "what kind of event, what day." Both nullable and purely
-- descriptive: the pipeline's upload deadlines, reminder emails, and
-- gallery retention all still key off `event_date` alone, exactly as
-- before. `event_time` is stored as the raw "HH:MM" (24h) string an
-- <input type="time"> hands back rather than a real time/timestamp column
-- -- there's no timezone to reconcile it against (events aren't tied to
-- one), so it's display-only text, never computed against.
alter table bookings add column venue text;
alter table bookings add column event_time text;
