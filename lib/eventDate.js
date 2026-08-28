// Shared between the cancel and reschedule routes -- both need the exact
// same "hours until this date" math to stay in sync (a cancellation refused
// as "too late" but a reschedule allowed for the same booking, or vice
// versa, would be a confusing inconsistency for a host).

// event_date is a plain date (no time-of-day), so "N hours before the
// event" is measured from midnight on that date.
export function hoursUntilEventDate(dateStr) {
  return (new Date(`${dateStr}T00:00:00`).getTime() - Date.now()) / 3600000;
}

export function isAtLeast24HoursOut(dateStr) {
  return hoursUntilEventDate(dateStr) >= 24;
}
