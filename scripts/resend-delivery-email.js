// Re-sends the "your recap is ready" notification for an already-delivered
// booking.
//
// finalizeDelivery (scripts/auto-recap.js) sends that email inside a try/catch
// and deliberately does not fail the delivery if the send throws -- the recap
// is genuinely finished either way, and a booking stuck un-delivered would be
// worse. The cost of that choice is there's no retry: if the send fails, the
// host is simply never told their recap exists.
//
// That happened. An extensionless ESM import in lib/email.js made
// require("../lib/email") throw inside the schedulers, so delivery
// notifications failed silently for hours (fixed in 14c94de, guarded by
// scripts/lib-require.test.js). This is the manual remedy for the bookings
// caught in that window, and for any future send that fails the same way.
//
// Read-only by default:
//   node scripts/resend-delivery-email.js <bookingId>          # show, send nothing
//   node scripts/resend-delivery-email.js <bookingId> --send   # actually send

require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const bookingId = args.find((a) => !a.startsWith("--"));

  if (!bookingId) {
    console.error("Usage: node scripts/resend-delivery-email.js <bookingId> [--send]");
    process.exit(1);
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, host_name, email, status, delivered_at, gallery_expires_at")
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    console.error("Booking not found:", bookingId);
    process.exit(1);
  }

  // Only ever for a booking that really is delivered -- telling a host their
  // recap is ready when it isn't would be worse than the missing email.
  if (booking.status !== "delivered" || !booking.delivered_at) {
    console.error(`Booking is "${booking.status}" (delivered_at=${booking.delivered_at}) -- refusing to send a "your recap is ready" email.`);
    process.exit(1);
  }

  const galleryUrl = `${process.env.APP_URL}/gallery/${booking.id}`;
  const expiresDate = booking.gallery_expires_at
    ? new Date(booking.gallery_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  console.log(`to         : ${booking.email}`);
  console.log(`hostName   : ${booking.host_name}`);
  console.log(`galleryUrl : ${galleryUrl}`);
  console.log(`expires    : ${expiresDate}`);
  console.log(`delivered  : ${booking.delivered_at}`);

  if (!send) {
    console.log("\nDry run -- nothing sent. Re-run with --send to deliver it.");
    return;
  }

  const { sendDeliveryNotification } = require("../lib/email");
  await sendDeliveryNotification({
    to: booking.email,
    hostName: booking.host_name,
    galleryUrl,
    expiresDate,
  });
  console.log("\nSent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
