import { NextResponse } from "next/server";

// This used to be middleware.js -- Next.js 16 renamed the convention to
// proxy.js/export function proxy() to clarify it's a network boundary /
// routing concern, not general-purpose middleware. Runs on the Node.js
// runtime now (proxy doesn't support the edge runtime the old middleware.js
// ran on), but nothing here needed edge specifically -- see the comment on
// timingSafeEqualString below.
//
// Next.js middleware runs on the Edge runtime, which has no `node:crypto` --
// so this can't reuse crypto.timingSafeEqual like lib/confirmToken.js and
// the dashboard-auth route do. Same technique, just built on TextEncoder
// (Edge/Web-standard) instead: XOR every byte and OR the results together,
// so the loop takes the same number of steps regardless of where (or
// whether) a mismatch occurs, rather than a plain === that can short-circuit
// at the first differing character. Same length-check precedent as those
// other two call sites -- a differing length returns immediately, since
// leaking "the lengths didn't match" isn't the leak this guards against.
function timingSafeEqualString(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function proxy(req) {
  // Public booking creation must stay open to unauthenticated customers.
  if (req.nextUrl.pathname === "/api/bookings" && req.method === "POST") {
    return NextResponse.next();
  }

  // Clicked from the confirmation email by whoever owns that address --
  // must stay open to unauthenticated visitors. The token itself (verified
  // in the route handler) is what proves the click is legitimate, not this
  // dashboard cookie.
  if (/^\/api\/bookings\/[^/]+\/confirm$/.test(req.nextUrl.pathname) && req.method === "GET") {
    return NextResponse.next();
  }

  const cookieValue = req.cookies.get("dashboard_auth")?.value;
  const isAuthed =
    !!process.env.DASHBOARD_PASSWORD &&
    !!cookieValue &&
    timingSafeEqualString(cookieValue, process.env.DASHBOARD_PASSWORD);
  if (!isAuthed) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/dashboard-login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/bookings", "/api/bookings/:path*", "/api/admin/:path*"],
};
