// Spotlight/Luxe are advertised as unlimited -- no real host or guest list
// gets anywhere near 2000 raw photos for one event, so this ceiling is
// purely an anti-abuse backstop (a guessed/leaked event link scripting
// uploads forever) rather than a real product constraint. Anything not
// listed here (Free) falls back to the 500-photo default -- Free's real cap
// is its 20-photo curated gallery downstream, not this raw-upload count.
const MAX_UPLOADS_PER_EVENT = { standard: 500, premium: 2000, keepsake: 2000 };
const DEFAULT_MAX_UPLOADS_PER_EVENT = 500;

export function getUploadLimit(tier) {
  return MAX_UPLOADS_PER_EVENT[tier] ?? DEFAULT_MAX_UPLOADS_PER_EVENT;
}
