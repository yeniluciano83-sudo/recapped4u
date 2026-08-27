-- Lets hosts guarantee a photo makes it into the main recap video,
-- independent of Claude's technical_quality score (see buildShortlist in
-- scripts/auto-recap.js) -- a photo can be emotionally beautiful but score
-- low on that purely technical axis (motion blur, backlighting, off-center
-- framing) and get cut from the video even though it stays in the gallery.
-- Mirrors must_include_social (migration 006), which does the same for the
-- social cut specifically. This one applies to every tier, since every
-- tier gets a main video (only Signature/Luxe get a social cut).
alter table uploads add column must_include boolean not null default false;
