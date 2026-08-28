// Next's official hook for exactly this purpose -- guaranteed to run once,
// before any route/page code executes, so Sentry's automatic
// uncaughtException/unhandledRejection capture (see lib/sentry.js) is
// actually watching from the start. Needs experimental.instrumentationHook
// in next.config.mjs on Next 14 (stable, no flag, from Next 15 on).
export async function register() {
  // @sentry/node isn't edge-runtime compatible, and nothing in this app
  // runs API routes on the edge runtime anyway -- only initialize for the
  // real Node server.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/sentry.js");
  }
}
