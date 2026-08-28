// Extracted from scripts/auto-recap.js so this tier-driven retention math
// can be unit tested directly -- it's what backs the "downloadable gallery
// for 2/4/6 months" copy on the pricing page, so a silent drift here would
// mean the site advertises a retention window the pipeline doesn't honor.

// Highlight's gallery stays downloadable for 2 months, Spotlight's for 4,
// and Luxe's for 6. Free's gallery is downloadable for 7 days total, then
// permanently deleted (see galleryPurgeAt in auto-recap.js, which is set to
// this same date for free). Anything not listed here falls back to 90 days.
const GALLERY_EXPIRY_DAYS = { free: 7 };
const GALLERY_EXPIRY_MONTHS = { standard: 2, premium: 4, keepsake: 6 };

function computeGalleryExpiry(tier) {
  const expiresAt = new Date();
  const days = GALLERY_EXPIRY_DAYS[tier];
  const months = GALLERY_EXPIRY_MONTHS[tier];
  if (days) {
    expiresAt.setDate(expiresAt.getDate() + days);
  } else if (months) {
    expiresAt.setMonth(expiresAt.getMonth() + months);
  } else {
    expiresAt.setDate(expiresAt.getDate() + 90);
  }
  return expiresAt;
}

module.exports = { computeGalleryExpiry };
