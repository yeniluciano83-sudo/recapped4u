import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rateLimit";

// Read-only lookup, deliberately separate from redeem_promo_code (migrations/
// 042 and 043) -- the booking form calls this as someone types a code, well
// before they've committed to a tier or submitted anything, so it must never
// consume a use. Only tells the form enough to steer the tier picker (valid
// + which tier, if any, it's restricted to); the real redeem happens exactly
// once, atomically, inside POST /api/bookings at actual submit time.
export async function POST(req) {
  const { success } = await checkRateLimit("promo-code-check", req, { requests: 20, windowSeconds: 60 });
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please slow down and try again shortly." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ valid: false });
  }

  const { data, error } = await supabase
    .from("promo_codes")
    .select("active, tier_restriction, max_uses, use_count")
    .eq("code", code)
    .maybeSingle();

  // A lookup failure or a genuinely missing code both just read as "not
  // valid" to the form -- there's nothing actionable to tell a typing user
  // apart from that, and this endpoint isn't the actual gate (submit is).
  if (error || !data) {
    return NextResponse.json({ valid: false });
  }

  const exhausted = data.max_uses != null && data.use_count >= data.max_uses;
  if (!data.active || exhausted) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({ valid: true, tierRestriction: data.tier_restriction || null });
}
