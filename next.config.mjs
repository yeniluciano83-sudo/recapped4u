// Security response headers applied to every route. Deliberately does NOT
// include a full Content-Security-Policy: the app renders hundreds of inline
// style attributes (React style={{...}}) and relies on Next's inline
// hydration scripts, so an enforcing script-src/style-src CSP needs its own
// careful, report-only-first rollout rather than a blind add here. The
// directives below are the ones that are safe without enumerating every
// script/style origin.
const SECURITY_HEADERS = [
  // HTTPS only, remembered for 2 years, subdomains included.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Don't let a browser MIME-sniff a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing at all -- the dashboard and the gallery would otherwise be
  // clickjackable. frame-ancestors 'none' is the modern equivalent; both
  // are sent for older-browser coverage.
  { key: "X-Frame-Options", value: "DENY" },
  // Host-management URLs carry the ?t=<token> credential in the query
  // string; only the origin (never the path/query) is sent on a
  // cross-origin request, so the token can't leak via Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Features the app never uses -- deny them outright.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel sets VERCEL_GIT_COMMIT_SHA automatically at build time (no
  // dashboard toggle needed). Baking it into the client bundle lets an
  // already-open upload page detect it's running an older deploy -- see
  // app/api/build-version/route.js and the staleness check in both upload
  // pages. Falls back to "dev" locally, where this var doesn't exist.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
