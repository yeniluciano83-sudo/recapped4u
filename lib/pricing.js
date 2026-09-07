// Shared between the public booking route (app/api/bookings) and the
// staff custom-quote route (app/api/admin/custom-quote) -- both need the
// same tier-driven eligibility/pricing rules to stay in sync rather than
// drifting if only one call site gets updated.

export const TIER_PRICES = {
  free: { amount: 0, label: "Free Package" },
  standard: { amount: 3500, label: "Highlight Package" },
  premium: { amount: 7500, label: "Spotlight Package" },
  keepsake: { amount: 9500, label: "Luxe Package" },
};

export const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];

// Every tier gets Roast Reel now, and Light is complimentary on all of
// them. Spotlight is the only tier that ever charges for it -- stepping
// up to Lukewarm/Hot there is +$20. Luxe is complimentary at every
// intensity. Kept in sync with roastAddonPrice in app/booking/page.jsx
// (dollars there, cents here for Stripe).
export const ROAST_FULL_LEVELS_TIERS = ["premium", "keepsake"];
export function roastAddonPriceCents(tier, level) {
  if (tier === "premium") return level === "light" ? 0 : 2000;
  return 0;
}

// Roast intensity (Lukewarm/Hot) only ever changes anything by making the
// *full video's* captions spicier -- scripts/auto-recap.js renders every
// social cut caption-free regardless of delivery format or roast_enabled
// (dropped by request; see renderOneSocialCut). "Social cuts of every
// photo" bookings have no full video to caption at all, so intensity is
// pure upcharge with zero effect there. Clamp it out the same way a
// tier that doesn't get full levels already is, rather than let a
// Spotlight host pay +$20 for a Hot roast a social-cuts-only booking can
// never actually deliver.
export function isRoastLevelSelectable(tier, deliveryFormat) {
  return ROAST_FULL_LEVELS_TIERS.includes(tier) && deliveryFormat !== "social_cuts";
}

// Polaroid across the board now (was grid everywhere except social-cuts-only,
// which got Polaroid for its own reason -- every uploaded photo lands
// somewhere in that gallery with no curation cutting it down, and Polaroid's
// one-photo-at-a-time layout suits a larger, less-curated gallery). No
// longer format-dependent, so this takes no argument -- kept as a function
// rather than inlining "polaroid" at each call site so there's still one
// place this default lives, matching migrations/035_polaroid_default.sql's
// DB-level default (belt and suspenders: every real insert already sets
// this explicitly, but nothing has to remember to import this function to
// still land on Polaroid).
export function defaultGalleryTemplate() {
  return "polaroid";
}
