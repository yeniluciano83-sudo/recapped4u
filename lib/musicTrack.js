// CommonJS, not ESM -- same reasoning as lib/socialPhotoStyle.js: this
// file's only real consumer is scripts/auto-recap.js, a CommonJS script.
// Extracted (rather than left inline in auto-recap.js) so this specific
// clamping decision can be unit tested on its own.

// public/music/<style>/ -- each style now holds several candidate tracks
// (see the commit that added public/music/<style>/track-2.mp3 onward)
// instead of a single track-1.mp3. Kept here as a plain count rather than
// re-deriving it from the filesystem: auto-recap.js needs this synchronously
// at spec-build time, well before any of its usual fs/R2 work.
const STYLE_TRACK_COUNTS = {
  cinematic: 10,
  upbeat: 12,
  documentary: 10,
  retro: 3,
  highlight: 8,
};

// booking.music_track / booking.social_music_track are 1-based indices into
// that style's track list, set by the booking form's music picker. Clamped
// rather than trusted as-is: an out-of-range value (a track later removed
// from disk, a bad manual DB edit, or an unrecognized style) would otherwise
// index past the real track list and crash the render instead of just
// falling back to that style's original track 1.
function resolveMusicSelection(style, trackNumber) {
  const resolvedStyle = STYLE_TRACK_COUNTS[style] ? style : "cinematic";
  const count = STYLE_TRACK_COUNTS[resolvedStyle];
  const resolvedTrack = Number.isInteger(trackNumber) && trackNumber >= 1 && trackNumber <= count ? trackNumber : 1;
  return { style: resolvedStyle, track: resolvedTrack };
}

module.exports = { STYLE_TRACK_COUNTS, resolveMusicSelection };
