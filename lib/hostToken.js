import crypto from "crypto";

// Separates "can upload to this event" from "can cancel/reschedule/close it".
//
// upload_slug can't do that job on its own: it's printed on the QR poster and
// handed to every guest at the event, so before this existed, any guest who
// scanned the code could POST /api/events/<slug>/cancel and kill the booking.
// Worse than it sounds -- the cancel route flips status to "cancelled" before
// it ever checks refund eligibility, so a guest standing at the event (where
// isAtLeast24HoursOut is false) couldn't get the money back but could still
// destroy the recap.
//
// Same stateless HMAC trick as lib/confirmToken.js -- no new column, the
// signature itself is the proof, verified against the booking id. The
// "host-action:" prefix is load-bearing: it keeps these from being
// interchangeable with confirm tokens, so a booking-confirmation link can't
// be replayed as a cancel credential.
export function generateHostToken(bookingId) {
  return crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(`host-action:${bookingId}`)
    .digest("hex");
}

export function isValidHostToken(bookingId, token) {
  if (!token) return false;
  const expected = generateHostToken(bookingId);
  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false, and a differing length isn't the leak this guards.
  if (expectedBuf.length !== tokenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
}

// The host token rides in the "t" query param on every host-only route,
// including POSTs -- the emailed links already carry it, and reading it from
// the URL keeps GET and POST identical instead of splitting it across query
// string and body.
export function hostTokenFromRequest(req) {
  // Base + try/catch because req.url isn't guaranteed absolute -- it's a full
  // URL from the Next runtime, but a relative path (or absent) from a hand-
  // built request object, and an unparseable URL here should read as "no
  // token" rather than throwing a 500 out of a route's auth check.
  try {
    return new URL(req?.url ?? "", "http://localhost").searchParams.get("t");
  } catch {
    return null;
  }
}
