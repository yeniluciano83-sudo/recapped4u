import { NextResponse } from "next/server";

export function middleware(req) {
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

  const isAuthed =
    !!process.env.DASHBOARD_PASSWORD &&
    req.cookies.get("dashboard_auth")?.value === process.env.DASHBOARD_PASSWORD;
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
