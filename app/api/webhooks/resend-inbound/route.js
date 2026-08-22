import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabase } from "@/lib/supabase";
import { sendCustomInquiryReplyNotice } from "@/lib/email";

const resend = new Resend(process.env.RESEND_API_KEY);

// Matches the inquiry-<uuid>@<domain> address handed out as replyTo by
// lib/email.js's inquiryReplyAddress() -- this is the only thing that
// associates an inbound email with a specific custom_inquiries row.
const INQUIRY_ADDRESS_RE = /^inquiry-([0-9a-f-]{36})@/i;

function extractEmailAddress(fromHeader) {
  const match = fromHeader && fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader || "").trim().toLowerCase();
}

// Best-effort plain-text fallback when a client sends HTML-only (no text
// part) -- not meant to be a faithful render, just enough for a dashboard
// preview and the staff notification email.
function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req) {
  const rawBody = await req.text();

  let event;
  try {
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: req.headers.get("svix-id"),
        timestamp: req.headers.get("svix-timestamp"),
        signature: req.headers.get("svix-signature"),
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });
  } catch (err) {
    console.error("Resend inbound webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ received: true });
  }

  // `to` is an array -- a reply can carry more than one recipient (e.g. cc'd
  // addresses), so find whichever one is actually the inquiry address rather
  // than assuming index 0.
  const inquiryAddress = (event.data.to || []).find((addr) => INQUIRY_ADDRESS_RE.test(addr));
  const inquiryId = inquiryAddress ? inquiryAddress.match(INQUIRY_ADDRESS_RE)[1] : null;

  if (!inquiryId) {
    // Not addressed to a per-inquiry address -- nothing for this webhook to
    // do with it (could be misconfigured routing, or another use of the
    // same receiving domain down the line).
    return NextResponse.json({ received: true });
  }

  const { data: inquiry, error: inquiryError } = await supabase
    .from("custom_inquiries")
    .select("id, host_name, email, event_type")
    .eq("id", inquiryId)
    .single();

  if (inquiryError || !inquiry) {
    console.error(`Resend inbound webhook: no inquiry found for id ${inquiryId}`);
    return NextResponse.json({ received: true });
  }

  const { data: full, error: fetchError } = await resend.emails.receiving.get(event.data.email_id);
  if (fetchError || !full) {
    console.error("Failed to fetch received email body:", fetchError?.message);
    // 500 so Resend retries -- the webhook only gave us metadata, so
    // without this fetch there's no message body to save at all.
    return NextResponse.json({ error: "Failed to fetch email body" }, { status: 500 });
  }

  const body = full.text || (full.html ? stripHtml(full.html) : "(no readable content)");
  const direction = extractEmailAddress(event.data.from) === inquiry.email.toLowerCase() ? "inbound" : "outbound";

  await supabase.from("custom_inquiry_messages").insert({ inquiry_id: inquiryId, direction, body });

  if (direction === "inbound") {
    try {
      await sendCustomInquiryReplyNotice({
        hostName: inquiry.host_name,
        eventType: inquiry.event_type,
        preview: body.slice(0, 300),
        inquiryId,
      });
    } catch (err) {
      // The message is already saved and visible in the dashboard -- a
      // failed heads-up email shouldn't fail the webhook.
      console.error("Reply notice email failed:", err.message);
    }
  }

  return NextResponse.json({ received: true });
}
