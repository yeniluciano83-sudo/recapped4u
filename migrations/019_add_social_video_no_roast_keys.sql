-- Social cuts previously never carried Roast Reel captions at all, so there
-- was nothing to add a caption-free twin of. Now that finalizeDelivery
-- (scripts/auto-recap.js) generates a per-cut roast script when
-- booking.roast_enabled, each roasted cut also renders a caption-free
-- version, same as full_video_no_roast_key already does for the full video.
-- roast_enabled is a single booking-level flag (not per-cut), so this is
-- either fully populated (same length as social_video_keys) or left null --
-- never partially populated.
alter table deliverables add column social_video_no_roast_keys text[];
