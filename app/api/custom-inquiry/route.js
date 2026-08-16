import { NextResponse } from "next/server";
import { sendCustomInquiry } from "@/lib/email";

// Custom packages have no fixed price, so there's nothing to create a
// booking or Stripe session for here -- this just emails the inquiry
// straight to the business. Payment, if any, happens outside the app
// once scope and price are agreed on directly with the host.
export async function POST(req) {
  try {
    const body = await req.json();
    const { hostName, email, eventType, eventDate, guestCount, style, notes } = body;

    if (!hostName || !email || !eventType || !eventDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await sendCustomInquiry({ hostName, email, eventType, eventDate, guestCount, style, notes });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Custom inquiry failed:", err);
    return NextResponse.json({ error: "Inquiry failed" }, { status: 500 });
  }
}
