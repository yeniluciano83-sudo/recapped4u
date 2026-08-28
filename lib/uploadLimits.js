// Spotlight/Luxe are advertised as unlimited -- no real host or guest list
// gets anywhere near 2000 raw photos for one event, so this ceiling is
// purely an anti-abuse backstop (a guessed/leaked event link scripting
// uploads forever) rather than a real product constraint. Free is capped at
// the same 20 photos its curated gallery keeps, so nothing beyond that ever
// needs processing. Anything not listed here falls back to the 500-photo
// default.
const MAX_UPLOADS_PER_EVENT = { free: 20, standard: 500, premium: 2000, keepsake: 2000 };
const DEFAULT_MAX_UPLOADS_PER_EVENT = 500;

export function getUploadLimit(tier) {
  return MAX_UPLOADS_PER_EVENT[tier] ?? DEFAULT_MAX_UPLOADS_PER_EVENT;
}
