// One-off migration aid for the host-token change (see lib/hostToken.js).
//
// Host management links used to be just /qr/<upload_slug>, with no credential
// beyond the slug -- which is the same value printed on the guest QR poster.
// Now those routes require a signed host token, so every link already sitting
// in a host's inbox from before the change will come back 403.
//
// This finds the bookings that still have a host who might click one, and can
// re-send their booking confirmation, which now carries tokenised links.
//
// Read-only by default -- it prints what it would do. Pass --send to actually
// email people:
//
//   node scripts/resend-host-links.js            # list only, sends nothing
//   node scripts/resend-host-links.js --send     # re-send confirmations
//
// Delivered and cancelled bookings are skipped: there's nothing left for a
// host to manage, so a surprise email would be worse than a dead link.

require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Statuses where the host still has something to do -- share the QR, close
// uploads early, reschedule, cancel. Anything past this and the links are moot.
const ACTIVE_STATUSES = ["booked", "pending_confirmation", "collecting"];

async function main() {
  const send = process.argv.includes("--send");

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, host_name, email, event_type, event_date, guest_count, tier, style, upload_slug, status, roast_enabled, delivery_format")
    .in("status", ACTIVE_STATUSES)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("Failed to query bookings:", error.message);
    process.exit(1);
  }

  if (!bookings.length) {
    console.log("No active bookings -- nothing to re-send.");
    return;
  }

  console.log(`${bookings.length} active booking(s)${send ? "" : "  [dry run -- pass --send to email]"}\n`);

  const { generateHostToken } = await import("../lib/hostToken.js");
  let sent = 0;
  let failed = 0;

  for (const b of bookings) {
    const link = `${process.env.APP_URL}/qr/${b.upload_slug}?t=${generateHostToken(b.id)}`;
    console.log(`${b.status.padEnd(20)} ${b.event_date}  ${b.host_name} <${b.email}>`);
    console.log(`  ${link}`);

    if (!send) continue;

    try {
      const { sendBookingConfirmation } = await import("../lib/email.js");
      await sendBookingConfirmation({
        to: b.email,
        hostName: b.host_name,
        eventDate: b.event_date,
        eventType: b.event_type,
        guestCount: b.guest_count,
        tier: b.tier,
        style: b.style,
        // Re-send, not a new charge -- the original confirmation already
        // reported the real amount, so don't restate a number here.
        amountPaid: null,
        roastEnabled: b.roast_enabled,
        uploadUrl: `${process.env.APP_URL}/event/${b.upload_slug}`,
        uploadSlug: b.upload_slug,
        bookingId: b.id,
        deliveryFormat: b.delivery_format,
      });
      sent += 1;
      console.log("  -> re-sent");
    } catch (err) {
      failed += 1;
      console.error(`  -> FAILED: ${err.message}`);
    }
  }

  if (send) console.log(`\nRe-sent ${sent}, failed ${failed}.`);
  else console.log("\nDry run -- no email sent. Re-run with --send to deliver these.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
