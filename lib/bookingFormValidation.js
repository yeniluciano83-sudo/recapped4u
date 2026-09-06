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

// Deliberately NOT folded into canProceedFromStyleStep above, even though
// both gate the same step-3 Continue button -- that function is shared with
// app/api/bookings/route.js as the actual server-side source of truth, and
// roastChoiceMade has no server-side meaning to check. roastEnabled is
// already a valid, correctly-handled value server-side by itself (false is
// exactly as legitimate a stored value whether a host explicitly chose it or
// just never touched the control); there's no "null" state for roast the
// way there was for style, so there is nothing for the server to reject.
// This is purely a client-side nudge to make a host decide, and stays that
// way -- app/booking/page.jsx composes this with canProceedFromStyleStep
// itself, the server never calls it.
//
// Roast is genuinely optional everywhere else -- the checkbox defaults to
// unchecked, and "left unchecked" is a perfectly valid, deliberate answer on
// every other format. Social-cuts-only is different: it uses every uploaded
// photo with nothing curated out, so roast-or-not affects the entire
// deliverable rather than an add-on layered over an otherwise-curated video
// -- a decision with that much reach shouldn't be able to slide through on
// an untouched default. roastChoiceMade tracks whether the host actually
// interacted with the control at all (set true on either direction of the
// choice), not what they picked -- an explicit "no" satisfies this the same
// as an explicit "yes".
export function hasMadeRequiredRoastChoice({ isSocialCutsFormat, roastChoiceMade }) {
  return !isSocialCutsFormat || Boolean(roastChoiceMade);
}
