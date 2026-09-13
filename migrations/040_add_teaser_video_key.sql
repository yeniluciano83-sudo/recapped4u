-- Storage key for the short, public "teaser" clip trimmed from a
-- Spotlight/Luxe booking's first social cut, watermarked for the host to
-- post to their own followers (not sent to guests) -- see
-- buildTeaserClip in lib/video-assemble.js and buildAndUploadTeaser in
-- scripts/auto-recap.js. Null for every booking with no social cut to
-- trim from (Free/Highlight tiers, or any deliverable created before this
-- column existed).
alter table deliverables add column if not exists teaser_video_key text;
