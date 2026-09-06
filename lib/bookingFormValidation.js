// Extracted purely so this one boolean expression can be unit tested.
// app/booking/page.jsx has no render-test setup -- nothing in this codebase
// does; every other test here is a pure-function or API-route test -- and
// this specific expression gates the Continue button on the site's actual
// conversion form, across five real branches (every tier below Spotlight/
// Luxe, plus Spotlight/Luxe's three delivery formats). A wrong boolean here
// either silently lets an incomplete booking through or silently blocks a
// complete one, with no error to ever surface it.
//
// Takes the already-derived isSocialCutEligible/isSocialCutsFormat rather
// than a raw tier, matching how app/booking/page.jsx already computes them
// for its own rendering -- this only needs to be the one place the actual
// gate lives, not a second source of tier-eligibility truth.
export function canProceedFromStyleStep({ isSocialCutEligible, deliveryFormat, isSocialCutsFormat, style, socialStyle }) {
  // Only Spotlight/Luxe choose a delivery format at all -- every other tier
  // only ever gets a full video, so there's nothing to require here for them.
  if (isSocialCutEligible && !deliveryFormat) return false;

  // Whichever theme picker is actually on screen is mandatory. socialStyle
  // in social-cuts-only mode -- the only style picker shown then, and it has
  // its own explicit "No theme" option, so unset really does mean nothing
  // was picked yet. style everywhere else: every tier below Spotlight/Luxe,
  // plus Spotlight/Luxe's "recap" (full video + social cuts) and
  // "video_only" formats, all produce a real full video with no such
  // opt-out.
  return Boolean(isSocialCutsFormat ? socialStyle : style);
}
