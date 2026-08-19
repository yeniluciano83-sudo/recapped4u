import crypto from "crypto";

// Stateless signed token so a free-tier booking's guest upload link can't go
// live until whoever owns the email address actually clicks the confirm
// link -- without this, anyone could book a free event under a stranger's
// email and it would go live immediately, with confirmation/upload-link
// emails sent to someone who never asked for them. No new DB column needed:
// the signature itself is the proof, verified against the booking id.
export function generateConfirmToken(bookingId) {
  return crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(`confirm-booking:${bookingId}`)
    .digest("hex");
}

export function isValidConfirmToken(bookingId, token) {
  if (!token) return false;
  const expected = generateConfirmToken(bookingId);
  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  if (expectedBuf.length !== tokenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
}
