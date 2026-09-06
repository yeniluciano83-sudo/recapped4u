import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Guards a failure mode the rest of the suite structurally cannot see.
//
// The scheduler scripts are CommonJS and pull shared code in with
// require("../lib/x"). Because those lib modules are ESM, that makes Node
// load them through its real ESM resolver -- which, unlike a bundler, does
// NOT do extensionless resolution. So `import { x } from "./y"` inside a lib
// module builds fine under Next, passes every other test here (vitest resolves
// it the same way the bundler does), works in every API route, and then throws
// "Cannot find module" the moment a scheduler run touches it.
//
// That is not hypothetical: an extensionless import added to lib/email.js took
// out delivery notifications, upload reminders and failure alerts for hours.
// Every one of those sends sits inside a try/catch that logs and moves on, so
// nothing surfaced -- a host just never got their "your recap is ready" email.
//
// Running the require in a real child process is the point. Importing the
// module here instead would go through vitest's resolver and prove nothing.

const repoRoot = path.resolve(import.meta.dirname, "..");

function scriptFiles() {
  return readdirSync(path.join(repoRoot, "scripts"))
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => path.join(repoRoot, "scripts", f));
}

// Every distinct ../lib/<name> the CJS scripts actually require.
function requiredLibModules() {
  const found = new Set();
  for (const file of scriptFiles()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/require\("\.\.\/(lib\/[A-Za-z0-9_-]+)"\)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe("lib modules required by the CommonJS scheduler scripts", () => {
  const modules = requiredLibModules();

  it("finds the require sites at all -- guards against this test silently testing nothing", () => {
    expect(modules.length).toBeGreaterThan(0);
    expect(modules).toContain("lib/email");
  });

  it.each(requiredLibModules())("%s loads under Node's real ESM resolver", (mod) => {
    const target = path.join(repoRoot, mod).replace(/\\/g, "/");
    let result;
    try {
      result = execFileSync(process.execPath, ["-e", `require(${JSON.stringify(target)})`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // Placeholder credentials so a missing key can't masquerade as a
        // resolution failure. lib/email.js in particular does
        // `new Resend(process.env.RESEND_API_KEY)` at module scope, and that
        // constructor throws on an absent key -- a real import-time failure,
        // but not the one this test is about.
        env: {
          ...process.env,
          NODE_OPTIONS: "--no-warnings",
          RESEND_API_KEY: process.env.RESEND_API_KEY || "re_placeholder_for_import_only",
          SUPABASE_URL: process.env.SUPABASE_URL || "https://placeholder.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder",
        },
      });
    } catch (err) {
      throw new Error(`require("${mod}") failed under Node:\n${err.stderr || err.message}`);
    }
    expect(result).toBeDefined();
  },
  // Each case is a cold Node process doing a real module load, not an
  // in-process import. lib/sentry pulls in the whole @sentry/node SDK and
  // blows past vitest's 5s default once these run alongside the rest of the
  // suite, so give the spawn genuine room.
  30_000);
});
