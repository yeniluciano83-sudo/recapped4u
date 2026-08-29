-- The gallery page's video "player" is a static gradient box with a play
-- button (clicking opens the actual video file in a new tab, see
-- app/gallery/[bookingId]/page.jsx) -- with no poster image, that box looks
-- like a placeholder rather than part of the finished product, right up
-- until a guest clicks play. Storing a real frame grabbed from each
-- rendered video (see extractPosterFrame in lib/video-assemble.js) lets the
-- gallery show that instead. One column per rendered video variant, mirroring
-- the *_key columns those posters belong to -- a roast-captioned cut's poster
-- can genuinely show caption text baked in, so its caption-free twin needs
-- its own separately-grabbed frame rather than reusing the same one.
alter table deliverables add column full_video_poster_key text;
alter table deliverables add column full_video_no_roast_poster_key text;
alter table deliverables add column social_video_poster_keys text[];
alter table deliverables add column social_video_no_roast_poster_keys text[];
