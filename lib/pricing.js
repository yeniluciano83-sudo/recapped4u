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

// bookings.gallery_template defaults to "grid" at the DB level (schema.sql)
// for every booking regardless of tier or format -- nothing before this ever
// set it explicitly at creation, only a host changing it later from their
// own gallery page. Social-cuts-only is worth a different default: every
// uploaded photo lands somewhere in the deliverable (no curation cutting the
// gallery down), and Polaroid's one-photo-at-a-time layout suits a gallery
// that's often larger and less curated than a typical delivery's.
export function defaultGalleryTemplate(deliveryFormat) {
  return deliveryFormat === "social_cuts" ? "polaroid" : "grid";
}
