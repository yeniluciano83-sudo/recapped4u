import { NextResponse } from "next/server";
import crypto from "crypto";

// In-memory per-instance limiter -- not distributed, but this endpoint guards
// a single shared password with no username, so the real threat is a script
// rapid-firing guesses against one warm instance, which this stops. A cold
// start resets the count; that's an acceptable tradeoff for this app's scale.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.windowStart > WINDOW_MS) {
    attempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

// Matches the timing-safe pattern already used in lib/confirmToken.js --
// a plain === leaks how many leading characters matched via response
// timing. Rate limiting + the fixed delay below already make this
// impractical to exploit, but there's no reason not to close it too.
function isCorrectPassword(candidate) {
  const expected = process.env.DASHBOARD_PASSWORD;
  // Without this, an unset DASHBOARD_PASSWORD coerces `expected` to "" below,
  // and an empty submitted password becomes two zero-length buffers -- which
  // timingSafeEqual treats as trivially equal, so login would "succeed" with
  // no password set. proxy.js independently blocks that cookie from
  // ever reaching /dashboard, so this was never a real bypass, but the login
  // response itself shouldn't claim success.
  if (!expected) return false;
  const candidateBuf = Buffer.from(candidate || "");
  const expectedBuf = Buffer.from(expected);
  if (candidateBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { password } = await req.json();
  // Slow down guessing regardless of outcome -- cheap deterrent against
  // automated brute force that doesn't depend on the in-memory counter above.
  await new Promise((r) => setTimeout(r, 400));
  if (isCorrectPassword(password)) {
    attempts.delete(ip);
    const res = NextResponse.json({ success: true });
    res.cookies.set("dashboard_auth", process.env.DASHBOARD_PASSWORD, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    return res;
  }
  return NextResponse.json({ success: false }, { status: 401 });
}
