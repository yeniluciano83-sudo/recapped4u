// Extracted so this specific decision can be unit tested. It lives inside
// scripts/auto-recap.js's continuePipelineWithAnalysis, a large orchestration
// function that does real R2/sharp/ffmpeg work end to end -- nothing in this
// codebase unit-tests that function directly, so a bug in a piece of pure
// logic buried inside it has no test to catch it. This one had exactly that
// bug: enhancePhoto was called with booking.style at every call site, never
// booking.social_style, so a host's social-cut theme was honored by that
// cut's own music and pacing (styleVideoConfigFor(spec.socialStyle ||
// spec.style), STYLE_MUSIC[...] -- both already correct) but not by the
// color grade baked into its photos. On social-cuts-only specifically,
// booking.style is null (only social_style is ever required there -- see
// canProceedFromStyleStep), so STYLE_ADJUSTMENTS[null] silently fell back to
// "cinematic" regardless of what the host actually picked.

// CommonJS, not ESM -- this file's only real consumer is
// scripts/auto-recap.js, a CommonJS script, and every other lib module it
// requires (photo-enhance.js, socialSelections.js, ...) is written the same
// way. An ESM `export` here would throw the moment auto-recap.js's plain
// require() tried to load it -- the exact class of bug an earlier fix this
// session (lib/email.js's extensionless import) ran into from the opposite
// direction. Vitest's ESM import still interops with this transparently
// (see socialSelections.test.js for the same pattern already in use).

// What a social cut's own photos should be graded with -- the same
// precedence already used for that cut's video-level style: an explicit
// social_style wins, falling back to the main style. For social-cuts-only
// bookings, style is null, so this resolves to exactly social_style.
function resolveSocialPhotoStyle({ style, socialStyle }) {
  return socialStyle || style;
}

// Whether photos feeding a social cut need their own, separately-enhanced
// buffer rather than reusing the gallery/full-video's cached one.
//
// useAllPhotoSocialCuts is excluded on purpose: in that mode there is no
// separate "main" style for a grade to diverge from (the gallery loop is the
// only enhancement pass that runs at all, and it uses resolveSocialPhotoStyle
// directly), so there's nothing to separately re-grade.
//
// Everywhere else, a second pass is only worth its cost when it would
// actually change anything -- a "recap" (full video + social cuts) booking
// where the host picked a genuinely different theme for the social cut than
// the main video. The common case (no distinct social_style, or it matches
// the main style) reuses the same buffer for both, exactly as before this
// existed.
function socialPhotoNeedsSeparateGrade({ style, socialStyle, useAllPhotoSocialCuts }) {
  if (useAllPhotoSocialCuts) return false;
  return resolveSocialPhotoStyle({ style, socialStyle }) !== style;
}

module.exports = { resolveSocialPhotoStyle, socialPhotoNeedsSeparateGrade };
