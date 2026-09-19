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
  cinematic: 9,
  upbeat: 12,
  documentary: 10,
  retro: 9,
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

// A single track on loop (see mergeFullVideoChunks' -stream_loop -1) starts
// to feel repetitive on a long full recap video -- a Luxe/Spotlight event
// with a big shortlist (SHORTLIST_CAP in scripts/auto-recap.js is Infinity
// for every tier but Free) easily runs past one track's own length at
// SECONDS_PER_SLOT=4s per photo, e.g. 120 photos = 8 minutes. Past that
// point the full video gets a medley instead: the host's own pick first (so
// their choice still opens the video), then the rest of that style's pool
// in ascending order, cycling back to the start of the pool again (host's
// pick included) for as many extra plays as it actually takes to cover the
// target length -- not just one pass through the pool and hoping that's
// enough, since a truly enormous shortlist can outlast even a full medley
// once.
//
// getDurationSeconds(style, track) -> Promise<number> is injected rather
// than this function reaching for ffprobe itself, so the actual
// track-length math here stays a plain, fast, synchronous-feeling unit test
// (lib/musicTrack.test.js) with a fake duration table, while
// scripts/auto-recap.js supplies the real one backed by
// getAudioDurationSeconds (lib/video-assemble.js) plus its own small cache
// (the same handful of tracks get probed on every single render).
async function buildMusicPlaylist(style, trackNumber, targetDurationSeconds, getDurationSeconds) {
  const { style: resolvedStyle, track } = resolveMusicSelection(style, trackNumber);
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    return { style: resolvedStyle, tracks: [track] };
  }

  const count = STYLE_TRACK_COUNTS[resolvedStyle];
  const playOrder = [track];
  for (let i = 1; i <= count; i++) {
    if (i !== track) playOrder.push(i);
  }

  const tracks = [];
  let totalSeconds = 0;
  let i = 0;
  // Bails out after enough cycles through the whole pool that something is
  // clearly wrong (a duration resolving to 0 or garbage) rather than
  // spinning forever -- 50 full passes is already far beyond any real
  // event's video length.
  while (totalSeconds < targetDurationSeconds && i < count * 50) {
    const t = playOrder[i % playOrder.length];
    tracks.push(t);
    totalSeconds += await getDurationSeconds(resolvedStyle, t);
    i++;
  }
  return { style: resolvedStyle, tracks };
}

module.exports = { STYLE_TRACK_COUNTS, resolveMusicSelection, buildMusicPlaylist };
