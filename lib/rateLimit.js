import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// No-ops until UPSTASH_REDIS_REST_URL/TOKEN are set -- lets the app run
// (locally, or in any environment that hasn't configured Upstash yet)
// without crashing, at the cost of no rate limiting until it's configured.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

// One Ratelimit instance per (name, requests, windowSeconds) combo, reused
// across requests within this warm serverless instance rather than
// reconstructed every call.
const limiters = new Map();

function getLimiter(name, requests, windowSeconds) {
  if (!redis) return null;
  const cacheKey = `${name}:${requests}:${windowSeconds}`;
  if (!limiters.has(cacheKey)) {
    limiters.set(
      cacheKey,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
        prefix: `ratelimit:${name}`,
      })
    );
  }
  return limiters.get(cacheKey);
}

function getClientIp(req) {
  // Vercel sets x-real-ip to the true client IP -- unlike the LEFTMOST
  // x-forwarded-for entry, which the client fully controls (Vercel appends
  // the real IP *after* whatever the client sent). Keying the limiter off
  // the leftmost XFF value let an attacker rotate a spoofed value per
  // request and get a fresh budget each time, defeating the limit. Prefer
  // x-real-ip; fall back to the LAST XFF entry (the one Vercel appended),
  // then a fixed string.
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown"
  );
}

// Rate-limits by client IP. `name` scopes the limit to a specific route (or
// group of routes) so e.g. hammering the upload endpoint doesn't also burn
// through the budget for cancel/reschedule. Returns { success: true } (i.e.
// "allow") whenever Upstash isn't configured, rather than throwing.
export async function checkRateLimit(name, req, { requests, windowSeconds }) {
  const limiter = getLimiter(name, requests, windowSeconds);
  if (!limiter) return { success: true };
  return limiter.limit(getClientIp(req));
}
