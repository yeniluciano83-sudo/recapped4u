// Server-side error monitoring, shared by the Next.js API routes and the
// standalone pipeline scripts (scripts/auto-recap.js, poll-and-recap.js).
// Deliberately errors-only -- no performance tracing, no session replay,
// no client/browser-side reporting. Safe to import and call unconditionally
// everywhere: without SENTRY_DSN configured, every export below is a no-op,
// so this never becomes a new way for local dev or an unconfigured
// environment to break.
import * as Sentry from "@sentry/node";

// Eager, not lazy-on-first-capture: this needs to run before anything else
// in the process gets a chance to throw, so Sentry's default
// uncaughtException/unhandledRejection integrations are actually watching
// from the start -- an error nobody thought to wrap in captureError() below
// is exactly the kind this is for. Import side effects only run once
// (module caching), so it's safe for every route/script that imports this
// to trigger this block -- only the first one actually does anything.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // Errors only -- this app has no need for request tracing/performance
    // monitoring, and turning it on would mean shipping a lot more data
    // (and eating into Sentry's free-tier quota) for no one to ever look at.
    tracesSampleRate: 0,
  });
}

// context: { tags?: Record<string,string>, extra?: Record<string,unknown> }
// Call this ALONGSIDE the existing console.error at a call site, never
// instead of it -- console output is still what you read in a terminal
// during local dev or a `gh run view` on the scheduler, Sentry is what
// catches it when no one's watching either of those.
export function captureError(err, context = {}) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, { tags: context.tags, extra: context.extra });
}

// The pipeline scripts are short-lived processes (a GitHub Actions cron job,
// see .github/workflows/recap-scheduler.yml) that exit right after their
// main() resolves -- Sentry's event delivery is async, so without this the
// process can exit before a captured error actually finishes sending.
// Next.js API routes don't need this: the server process stays alive.
export async function flushSentry(timeoutMs = 2000) {
  if (!process.env.SENTRY_DSN) return;
  await Sentry.flush(timeoutMs);
}
