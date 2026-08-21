-- Luxe now gets multiple social cuts (Signature still gets 1). Keeping
-- social_video_key (singular) in sync with the first cut for backward
-- compatibility; this array is the complete, real list.
alter table deliverables add column social_video_keys text[];
