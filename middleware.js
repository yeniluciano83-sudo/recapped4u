import { NextResponse } from "next/server";

export function middleware(req) {
  // Public booking creation must stay open to unauthenticated customers.
  if (req.nextUrl.pathname === "/api/bookings" && req.method === "POST") {
    return NextResponse.next();
  }

  const isAuthed =
    !!process.env.DASHBOARD_PASSWORD &&
    req.cookies.get("dashboard_auth")?.value === process.env.DASHBOARD_PASSWORD;
  if (!isAuthed) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/dashboard-login?test=1", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/bookings"],
};
