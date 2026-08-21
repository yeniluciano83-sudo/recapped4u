-- Roast Reel bookings previously only ever got the captioned full-cut --
-- add a second, caption-free render of the same shortlist so hosts can
-- share a version without the roast lines. Null for non-roast bookings.
alter table deliverables add column full_video_no_roast_key text;
