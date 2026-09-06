// Extracted from scripts/poll-and-recap.js so this queue-ordering logic can
// be unit tested directly -- it's what actually enforces Luxe's advertised
// "48-hour priority turnaround", so a silent regression here would break
// that promise without any error ever being thrown.

function hoursSinceEvent(eventDate) {
  return (Date.now() - new Date(eventDate).getTime()) / (1000 * 60 * 60);
}

// Luxe is sold as "48-hour priority turnaround" -- meaningless if a backlog
// just processes bookings in whatever order Postgres happens to return them.
// Sorting the queue itself before the loop below is the only real lever this
// single-worker, one-booking-at-a-time runner has: when several bookings are
// eligible in the same run (or the job's 75-minute timeout cuts a run short,
// see .github/workflows/recap-scheduler.yml), Luxe goes first, then
// Spotlight, then Highlight, then Free -- ties within a tier broken by whoever
// has been waiting longest. This doesn't guarantee a 48h turnaround by
// itself (that also depends on run cadence and how long each recap takes),
// but it guarantees Luxe is never left waiting behind a lower tier.
const TIER_PROCESSING_PRIORITY = { keepsake: 0, premium: 1, standard: 2, free: 3 };

function sortByProcessingPriority(bookings) {
  return [...bookings].sort((a, b) => {
    const tierDiff = (TIER_PROCESSING_PRIORITY[a.tier] ?? 99) - (TIER_PROCESSING_PRIORITY[b.tier] ?? 99);
    if (tierDiff !== 0) return tierDiff;
    return new Date(a.event_date) - new Date(b.event_date);
  });
}

module.exports = { hoursSinceEvent, sortByProcessingPriority, TIER_PROCESSING_PRIORITY };
