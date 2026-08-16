require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for bookings ready to recap...`);

  // ADJUST: table name and column names to match your schema
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("status", "ready_for_recap"); // ADJUST: your actual status value

  if (error) {
    console.error("Failed to query bookings:", error.message);
    return;
  }

  if (!bookings || bookings.length === 0) {
    console.log("No bookings ready. Done.");
    return;
  }

  console.log(`Found ${bookings.length} booking(s) to process.`);

  for (const booking of bookings) {
    console.log(`\nProcessing booking ${booking.id}...`);
    try {
      execSync(`node "${__dirname}\\auto-recap.js" ${booking.id}`, {
        stdio: "inherit",
        cwd: require("path").join(__dirname, ".."),
      });
    } catch (err) {
      console.error(`Booking ${booking.id} failed:`, err.message);
      // continue to next booking instead of stopping the whole batch
    }
  }
}

main();