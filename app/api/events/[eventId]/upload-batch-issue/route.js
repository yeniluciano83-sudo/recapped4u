import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { captureMessage } from "@/lib/sentry";

// Fired by both upload pages (best-effort, fire-and-forget) when a batch
// ends with photos that never made it in for a reason retrying couldn't
// fix -- network/server failures that survived every retry attempt. This
// is deliberately narrow: it does NOT fire for a per-file rejection (wrong
// type, too large) or an expected booking-state stop (uploads closed,
// event cancelled) -- both are normal, not a reliability problem. The
// point is to catch a real upload-path issue (an R2/Supabase blip, a bad
// deploy) the moment it happens, instead of only noticing once someone
// sees a booking stalled at a low photo count.
export async function POST(req, { params }) {
  const { eventId } = await params;

  const { success } = await checkRateLimit("event-upload-batch-issue", req, { requests: 20, windowSeconds: 60 });
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const { uploadedCount, totalCount, failedCount } = body;

  captureMessage(`Upload batch had unresolved failures for event ${eventId}`, {
    tags: { route: "events.upload-batch-issue", eventId },
    extra: { uploadedCount, totalCount, failedCount },
  });

  return NextResponse.json({ ok: true });
}
