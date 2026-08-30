import { NextResponse } from "next/server";

// Lets an already-open tab detect that a newer deploy has landed (see
// NEXT_PUBLIC_BUILD_SHA in next.config.mjs). This reads whatever deployment
// is CURRENTLY serving requests, live -- unlike the client's own
// build-time-baked value, which stays frozen for as long as the tab's been
// open, however long that is.
export async function GET() {
  return NextResponse.json({ sha: process.env.VERCEL_GIT_COMMIT_SHA || "dev" });
}
