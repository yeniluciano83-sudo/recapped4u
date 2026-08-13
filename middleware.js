import { NextResponse } from "next/server";

export function middleware(req) {
  const isAuthed = req.cookies.get("dashboard_auth")?.value === process.env.DASHBOARD_PASSWORD;
  if (!isAuthed) {
    return NextResponse.redirect(new URL("/dashboard-login?test=1", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/dashboard/:path*",
};
