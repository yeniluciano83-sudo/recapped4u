import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendCustomQuote } from "@/lib/email";

const QUOTABLE_TIERS = ["standard", "premium", "keepsake"];

// Protected by middleware.js (dashboard_auth cookie). Re-postable: setting
// a quote on an already-quoted inquiry just updates the price/message and
// re-notifies the host -- that's how negotiation rounds happen, since
// there's no live chat here, just email + a standing quote record.
export async function POST(req, { params }) {
  const { id } = params;

  try {
    const { tier, priceDollars, message } = await req.json();

    if (!QUOTABLE_TIERS.includes(tier)) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }
    const priceCents = Math.round(Number(priceDollars) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }

    const { data: inquiry, error } = await supabase
      .from("custom_inquiries")
      .update({
        quoted_tier: tier,
        quoted_price_cents: priceCents,
        quote_message: message || null,
        status: "quoted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !inquiry) {
      return NextResponse.json({ error: "Inquiry not found" }, { status: 404 });
    }

    const priceFormatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(priceCents / 100);

    await supabase.from("custom_inquiry_messages").insert({
      inquiry_id: id,
      direction: "outbound",
      body: `Quote sent: ${priceFormatted}${message ? `\n\n${message}` : ""}`,
    });

    try {
      await sendCustomQuote({
        inquiryId: id,
        to: inquiry.email,
        hostName: inquiry.host_name,
        eventType: inquiry.event_type,
        eventDate: inquiry.event_date,
        tier,
        priceFormatted,
        message: inquiry.quote_message,
        quoteUrl: `${process.env.APP_URL}/custom-quote/${id}`,
      });
    } catch (err) {
      console.error("Quote email failed (quote was still saved):", err.message);
    }

    return NextResponse.json({ success: true, inquiry });
  } catch (err) {
    console.error("Failed to set quote:", err);
    return NextResponse.json({ error: "Failed to set quote" }, { status: 500 });
  }
}
