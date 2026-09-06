import { generateHostToken } from "@/lib/hostToken";

// The host-only event routes read their credential off the request URL (see
// lib/hostToken.js), but route tests hand-build plain request objects that
// have no URL at all. This mints a real signed token so those tests exercise
// the authorized path; the unauthorized path is asserted explicitly by the
// "rejects a request with no host token" cases rather than by omission, so a
// future route losing its guard fails loudly instead of silently passing.
//
// Signing key has to be set before generateHostToken runs -- createHmac
// throws on an undefined key, and route tests don't otherwise need env.
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-signing-secret";

// "b1" is the booking id every one of these route tests mocks.
export function hostUrl(bookingId = "b1") {
  return `http://localhost/api/events/slug-1?t=${generateHostToken(bookingId)}`;
}

// A URL that reaches the route but carries no credential -- what a guest who
// scanned the QR poster would have.
export function guestUrl() {
  return "http://localhost/api/events/slug-1";
}
