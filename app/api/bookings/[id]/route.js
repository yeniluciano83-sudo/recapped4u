import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { captureError } from "@/lib/sentry";

const VALID_STATUSES = ["booked", "collecting", "analyzing", "editing", "delivered"];
// Every real tier, not just the paid ones app/api/admin/custom-quote/route.js
// deals in -- staff need to be able to set a booking to Free too (a comp, a
// correction), not just move it between paid tiers.
const VALID_TIERS = ["free", "standard", "premium", "keepsake"];
// Keep in sync with STYLES in app/booking/page.jsx.
const VALID_STYLES = ["cinematic", "upbeat", "documentary", "retro", "highlight"];
// social_style additionally allows "none" ("No theme (no music)" --
// migrations/036_fix_social_style_none_constraint.sql) and null (unset,
// falls back to the main style).
const VALID_SOCIAL_STYLES = [...VALID_STYLES, "none"];
// scripts/auto-recap.js reads style/social_style throughout analysis and
// enhancement, not just once at submission -- changing either mid-pipeline
// could grade some photos with the old style and some with the new one.
// event_date feeds the same pipeline's own scheduling math (TIER_SCHEDULE in
// scripts/poll-and-recap.js computes hours-since-event to decide when to
// claim and process a booking) -- moving it out from under an already-
// claimed booking would desync deadlines it's already mid-run against, the
// same underlying risk as changing style mid-pipeline. All three are safe
// only before that starts -- matches RESCHEDULABLE_STATUSES' own threshold
// in the self-service reschedule route (app/api/events/[eventId]/reschedule
// /route.js), just without that route's separate 24-hour-before-event rule,
// which is a guest-facing notice period a staff correction isn't bound by.
const PROCESSING_STARTED_STATUSES = ["analyzing", "editing", "awaiting_roast_approval", "delivered"];

// Staff-only (gated by proxy.js's dashboard_auth check on the whole
// /api/bookings/:path* matcher, same as the GET on the parent route) --
// this is the admin equivalent of the self-service upgrade in
// app/api/events/[eventId]/upgrade/route.js: no Stripe checkout, no price
// validation against the tier's list price, because a phone-negotiated
// change or a comp isn't a self-service purchase. Whatever price staff
// enters here is trusted outright, the same way custom-quote's amount is.
export async function PATCH(req, { params }) {
  const { id } = await params;

  try {
    const body = await req.json();
    const update = {};

    if ("status" in body) {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      update.status = body.status;
    }

    if ("tier" in body) {
      if (!VALID_TIERS.includes(body.tier)) {
        return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
      }
      update.tier = body.tier;
      // A tier change can raise the upload cap (lib/uploadLimits.js) --
      // reset so a booking that already notified its host at the old cap
      // notifies again if the new, higher one is ever reached too. Same
      // reasoning as the self-service upgrade webhook and the photo-delete
      // handler that both already reset this for the same reason.
      update.upload_cap_notified_at = null;
    }

    if ("custom_price_cents" in body) {
      const cents = body.custom_price_cents;
      if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
        return NextResponse.json({ error: "Invalid custom price" }, { status: 400 });
      }
      update.custom_price_cents = cents;
    }

    if ("host_name" in body) {
      const name = (body.host_name || "").trim();
      if (!name) return NextResponse.json({ error: "Host name can't be empty" }, { status: 400 });
      update.host_name = name;
    }

    if ("email" in body) {
      const email = (body.email || "").trim();
      // Same lightweight shape check as the rest of this codebase bothers
      // with -- real deliverability is what actually sending to it proves,
      // not a regex.
      if (!email || !email.includes("@")) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      update.email = email;
    }

    if ("event_type" in body) {
      const type = (body.event_type || "").trim();
      if (!type) return NextResponse.json({ error: "Event type can't be empty" }, { status: 400 });
      update.event_type = type;
    }

    if ("guest_count" in body) {
      const count = body.guest_count;
      if (count !== null && (!Number.isFinite(count) || count < 0)) {
        return NextResponse.json({ error: "Invalid guest count" }, { status: 400 });
      }
      update.guest_count = count;
    }

    if ("notes" in body) {
      update.notes = body.notes || null;
    }

    // Validated here, before the fetch-and-lock-check block below, rather
    // than inside it -- a malformed date is a pure input error that
    // shouldn't cost a DB round-trip (or ever depend on one) to reject,
    // same as every other field's own validation above.
    if ("event_date" in body && (!body.event_date || Number.isNaN(new Date(`${body.event_date}T00:00:00`).getTime()))) {
      return NextResponse.json({ error: "Enter a valid date" }, { status: 400 });
    }

    if ("style" in body || "social_style" in body || "event_date" in body) {
      // Fetched fresh rather than trusting a status the dashboard might be
      // holding stale in its own state -- this is the actual gate, not a
      // client-side nicety. Includes the current values of every field this
      // block might lock, not just status: the dashboard's "Event details"
      // save always resends event_date alongside host_name/notes/etc. in one
      // request even when only fixing a typo elsewhere, so the lock has to
      // key off whether a field is actually CHANGING, not merely present in
      // the body -- otherwise a locked booking couldn't have its host name
      // corrected either, just because event_date rode along unchanged.
      const { data: current, error: fetchError } = await supabase.from("bookings").select("status, event_date, style, social_style").eq("id", id).single();
      if (fetchError || !current) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

      const styleChangeRequested =
        ("style" in body && body.style !== current.style) ||
        ("social_style" in body && (body.social_style ?? null) !== (current.social_style ?? null));
      const dateChangeRequested = "event_date" in body && body.event_date !== current.event_date;

      if (PROCESSING_STARTED_STATUSES.includes(current.status) && (styleChangeRequested || dateChangeRequested)) {
        const lockedFields = [];
        if (styleChangeRequested) lockedFields.push("style");
        if (dateChangeRequested) lockedFields.push("event date");
        return NextResponse.json(
          { error: `Can't change ${lockedFields.join(" or ")} once a booking is "${current.status}" -- processing has already started.` },
          { status: 400 }
        );
      }
      if ("style" in body) {
        if (!VALID_STYLES.includes(body.style)) return NextResponse.json({ error: "Invalid style" }, { status: 400 });
        update.style = body.style;
      }
      if ("social_style" in body) {
        if (body.social_style !== null && !VALID_SOCIAL_STYLES.includes(body.social_style)) {
          return NextResponse.json({ error: "Invalid social style" }, { status: 400 });
        }
        update.social_style = body.social_style;
      }
      if ("event_date" in body) {
        update.event_date = body.event_date;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Best-effort, and only when explicitly asked for -- a plain data
    // correction (fixing a typo) shouldn't email the host, but a real
    // reschedule should tell them, the same as the self-service flow does.
    if ("event_date" in update && body.notifyReschedule) {
      try {
        const { sendRescheduleConfirmation } = await import("@/lib/email");
        await sendRescheduleConfirmation({ to: data.email, hostName: data.host_name, oldDate: body.previousEventDate || "", newDate: data.event_date });
      } catch (err) {
        console.error(`Reschedule notification email failed for booking ${id}:`, err.message);
        captureError(err, { tags: { route: "bookings.update", email: "reschedule-confirmation" }, extra: { bookingId: id } });
      }
    }

    // Same opt-in shape as the reschedule notice above -- a tier/price edit
    // is just as often a plain correction as it is something the host
    // actually needs to hear about, so this only fires when staff checks
    // the box, not on every Package save.
    if (("tier" in update || "custom_price_cents" in update) && body.notifyPackageUpdate) {
      try {
        const { sendBookingUpdateConfirmation } = await import("@/lib/email");
        await sendBookingUpdateConfirmation({ to: data.email, hostName: data.host_name, tier: data.tier, customPriceCents: data.custom_price_cents });
      } catch (err) {
        console.error(`Package update email failed for booking ${id}:`, err.message);
        captureError(err, { tags: { route: "bookings.update", email: "package-update-confirmation" }, extra: { bookingId: id } });
      }
    }

    return NextResponse.json({ success: true, booking: data });
  } catch (err) {
    console.error("Booking update failed:", err);
    captureError(err, { tags: { route: "bookings.update" }, extra: { bookingId: id } });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
