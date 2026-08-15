// Server-side Supabase client using the service role key.
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser — it bypasses
// Row Level Security. Only import this file inside API routes / server code.

import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    // Next.js patches the global fetch() to cache GET requests by default.
    // Booking/deliverable data must always be read fresh, so opt every
    // Supabase request out of that cache explicitly.
    global: { fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }) },
  }
);
