-- Resumable rendering (migration 030) has a "full" first delivery INSERT its
-- deliverables row up front -- render_state set, no video yet -- so the
-- renderer has a row to checkpoint against across scheduled runs (see
-- startRender in scripts/auto-recap.js). The gallery route
-- (app/api/gallery/[bookingId]/route.js) treats "render_state set AND
-- delivered_at null" as "not ready yet".
--
-- But delivered_at was `not null default now()`, so the DB stamped that
-- in-progress row as delivered the instant it was created -- the gallery
-- then served a deliverable with a null full_video_key mid-render.
-- Confirmed live on the first real "full" booking through the resumable
-- path. delivered_at is now genuinely null until finalizeFullDelivery
-- sets it explicitly (which it already did).
alter table deliverables alter column delivered_at drop not null;
alter table deliverables alter column delivered_at drop default;
