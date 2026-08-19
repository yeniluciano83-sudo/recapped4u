import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Recapped For You <hello@recappedforyou.com>"; // switch to hello@recappedforyou.com once domain is verified in Resend

// Site's actual brand palette (see app/page.jsx) -- kept in sync manually
// since email HTML can't share the site's inline style objects directly.
const BG = "#FAF7F2";
const CARD = "#FFFFFF";
const BORDER = "#E4DED2";
const HEADING = "#211F1D";
const BODY = "#444444";
const MUTED = "#666666";
const FAINT = "#999999";
const ACCENT = "#C97A3D";
const SAGE = "#7A8B76";
const TINT = "#FBEEE0"; // the site's "selected" highlight tint
const AMBER = "#F5A855"; // brighter, more saturated version of the brand's warm tones
const CORAL = "#F0834D"; // used for the booking summary card -- deliberately louder than TINT
const BRIGHT_GRADIENT = `linear-gradient(135deg, ${AMBER}, ${CORAL})`;
// A darker, more saturated relative of CORAL for use as TEXT on white/cream
// backgrounds -- CORAL itself is only ~2.6:1 against white (fails WCAG AA
// even for large text), this is ~4.6:1 so headings stay legible.
const BRIGHT_TEXT = "#B85C1F";

// Wraps a template's inner content in the site's actual look: a warm
// gradient banner (same gradient as the site's own video-thumbnail area)
// topping a white rounded card, on the site's cream page background, with
// the LLC line beneath it -- mirrors the site's own footer placement,
// outside the card. Georgia for headings (email-safe, matches the site's
// serif; Arial/Helvetica stands in for Inter, which email clients can't
// load). `emoji` gives each email type its own small visual identity.
function wrapEmail(innerHtml, emoji = "🎬") {
  // Without an explicit color-scheme declaration, mail clients with a dark
  // mode (Yahoo Mail, Gmail's app, Apple Mail) will auto-invert an
  // unstyled light background to near-black -- a real bug, not a styling
  // mistake in the markup below. The meta tags + `color-scheme` CSS below
  // tell those clients this email is light-only and shouldn't be touched.
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <style>:root { color-scheme: light; supported-color-schemes: light; }</style>
      </head>
      <body style="margin: 0; padding: 0; background-color: ${BG};">
        <div style="background-color: ${BG}; padding: 40px 16px; font-family: Arial, Helvetica, sans-serif;">
          <div style="max-width: 480px; margin: 0 auto;">
            <div style="background: ${CARD}; border: 1px solid ${BORDER}; border-radius: 20px; overflow: hidden; box-shadow: 0 6px 28px rgba(33,31,29,0.07);">
              <div style="background-color: ${TINT}; background-image: linear-gradient(135deg, ${TINT}, ${BG}); padding: 30px 28px 22px; text-align: center; border-bottom: 1px solid ${BORDER};">
                <div style="font-size: 36px; line-height: 1; margin: 0 0 10px;">${emoji}</div>
                <p style="margin: 0; font-size: 11.5px; letter-spacing: 3px; text-transform: uppercase; color: ${SAGE}; font-weight: bold;">Recapped For You</p>
              </div>
              <div style="padding: 30px 28px; color: ${HEADING};">
                ${innerHtml}
              </div>
            </div>
            <p style="text-align: center; font-size: 11px; color: ${FAINT}; margin: 20px 0 0;">
              Recapped For You LLC, a New York limited liability company.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function ctaButton(href, label) {
  return `<a href="${href}" style="display: inline-block; background: ${ACCENT}; color: ${HEADING}; padding: 14px 26px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14.5px;">${label}</a>`;
}

function calloutBox(innerHtml) {
  return `<div style="background: ${BG}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 18px 20px;">${innerHtml}</div>`;
}

// One icon + label + description row for a scannable details list -- a
// fixed-size square (line-height == height, text-align center) centers the
// emoji without relying on flexbox, which Outlook's Word rendering engine
// ignores.
function detailRow(icon, label, text) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 16px;">
      <tr>
        <td width="34" valign="top" style="padding-right: 12px;">
          <div style="width: 30px; height: 30px; line-height: 30px; border-radius: 9px; background: ${TINT}; text-align: center; font-size: 15px;">${icon}</div>
        </td>
        <td valign="top">
          <p style="margin: 0 0 2px; font-size: 13px; font-weight: 700; color: ${BRIGHT_TEXT};">${label}</p>
          <p style="margin: 0; font-size: 13px; color: ${BODY}; line-height: 1.55;">${text}</p>
        </td>
      </tr>
    </table>
  `;
}

// Display names for stored ids -- keep in sync with the TIERS/STYLES arrays
// in app/booking/page.jsx. Price itself isn't duplicated here; the actual
// amount charged comes from the Stripe session at send time.
const TIER_LABELS = { free: "Free", standard: "Classic", premium: "Signature", keepsake: "Luxe" };
const STYLE_LABELS = { cinematic: "Cinematic", upbeat: "Upbeat", documentary: "Documentary", retro: "Nostalgic / Retro", highlight: "Highlight Reel" };

// Keep in sync with TIER_SCHEDULE in scripts/poll-and-recap.js.
const TIER_DEADLINE_LABELS = { free: "24 hours", standard: "48 hours", premium: "1 week", keepsake: "2 weeks" };
// Keep in sync with GALLERY_EXPIRY_DAYS / GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const TIER_RETENTION_LABELS = { free: "7 days", standard: "2 months", premium: "4 months", keepsake: "6 months" };

export async function sendBookingConfirmation({ to, hostName, eventDate, eventType, guestCount, tier, style, amountPaid, roastEnabled, uploadUrl, uploadSlug }) {
  const qrImageUrl = `${process.env.APP_URL}/api/qrcode/${uploadSlug}`;
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}`;
  const cancelUrl = `${process.env.APP_URL}/cancel/${uploadSlug}`;
  const rescheduleUrl = `${process.env.APP_URL}/reschedule/${uploadSlug}`;
  const deadline = TIER_DEADLINE_LABELS[tier] || "the deadline for your package";
  const retention = TIER_RETENTION_LABELS[tier] || "90 days";
  const summaryRow = (label, value) =>
    value
      ? `<tr><td style="padding: 8px 0; color: rgba(255,255,255,0.82); font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,0.2);">${label}</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: #FFFFFF; font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,0.2);">${value}</td></tr>`
      : "";

  return resend.emails.send({
    from: FROM,
    to,
    subject: "You're booked — here's your guest QR code",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center; color: ${BRIGHT_TEXT};">You're all set, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center; color: ${BRIGHT_TEXT};">Your event on ${eventDate} is booked. Share the QR code below with your guests so they can add their photos and videos.</p>

        <div style="background-color: ${CORAL}; background-image: ${BRIGHT_GRADIENT}; border-radius: 18px; padding: 26px 22px;">
          <table style="width: 100%; border-collapse: collapse; margin: 0 0 22px;">
            ${summaryRow("Package", TIER_LABELS[tier] || tier)}
            ${summaryRow("Amount paid", amountPaid)}
            ${summaryRow("Event", eventType)}
            ${summaryRow("Date", eventDate)}
            ${summaryRow("Guests", guestCount)}
            ${summaryRow("Editing style", STYLE_LABELS[style] || style)}
          </table>
          <div style="background: #FFFFFF; border-radius: 14px; padding: 18px; text-align: center;">
            <img src="${qrImageUrl}" alt="Guest upload QR code" width="180" height="180" style="border-radius: 10px; display: block; margin: 0 auto;" />
          </div>
          <p style="margin: 20px 0 0; text-align: center;">
            <a href="${qrPageUrl}" style="display: inline-block; background: #FFFFFF; color: ${CORAL}; padding: 14px 26px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14.5px;">Share or print your QR code</a>
          </p>
        </div>

        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 16px 0 26px;">
          Or share the guest link directly: <a href="${uploadUrl}" style="color: ${MUTED};">${uploadUrl}</a>
        </p>

        <h3 style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; margin: 0 0 10px; color: ${BRIGHT_TEXT};">The details</h3>
        ${calloutBox(`
          ${detailRow("📤", "Guest uploads", `Open for ${deadline} after your event — anything after that won't make the cut. Add your own photos or close uploads early from your QR share page above.`)}
          ${detailRow("⏳", "Delivery & retention", `Your recap arrives by email and stays accessible for ${retention} after delivery${tier === "free" ? ", then it's permanently removed" : ""}. Raw guest uploads are deleted 30 days after final delivery.`)}
          ${roastEnabled ? detailRow("🔥", "Roast Reel", "Nothing is shared with your guests until you've reviewed and approved the full script by email.") : ""}
          ${tier === "keepsake" ? detailRow("⏱️", "Need more time?", "Luxe includes a one-time 2-day deadline extension, available anytime from your QR share page.") : ""}
          ${detailRow("💳", "Cancellations", "More than 24 hours before your event gets a full refund. Inside 24 hours isn't eligible, since guest uploads may already be underway.")}
          ${detailRow("📅", "Need a new date?", "Reschedule for free anytime up to 24 hours before your event, right from the link below — your QR code and upload link stay the same.")}
          ${detailRow("🔒", "Your privacy", "Photos and videos are used only to produce this recap — never sold, shared, or used for advertising.")}
        `)}

        <p style="font-size: 12px; color: ${FAINT}; margin: 20px 0 0;">
          By completing your booking and payment, you agreed to these terms. <a href="${rescheduleUrl}" style="color: ${FAINT};">Reschedule</a> or <a href="${cancelUrl}" style="color: ${FAINT};">cancel your booking</a>. Questions? Just reply to this email.
        </p>
    `, "🎬"),
  });
}

export async function sendConfirmBookingEmail({ to, hostName, eventDate, eventType, confirmUrl }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Confirm your free recap",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">One click to activate, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center;">Someone requested a free recap for a ${eventType} on ${eventDate} using this email address. Confirm it's you to activate the guest upload link and QR code.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(confirmUrl, "Confirm this booking")}
        </p>
        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 0;">If you didn't request this, you can safely ignore this email — nothing goes live until this link is clicked.</p>
    `, "✅"),
  });
}

export async function sendCancellationConfirmation({ to, hostName, eventDate, refunded, amountRefunded }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your booking has been cancelled",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">Your booking is cancelled, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 14px; text-align: center;">Your event on ${eventDate} has been cancelled and the guest upload link is now closed.</p>
        ${calloutBox(`
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">${
            refunded
              ? `A full refund of ${amountRefunded} has been issued to your original payment method. It may take a few business days to appear.`
              : "This cancellation was made within 24 hours of the event, so it's not eligible for a refund per our cancellation policy."
          }</p>
        `)}
        <p style="font-size: 13px; color: ${MUTED}; margin: 20px 0 0; text-align: center;">If this wasn't you, or you have questions, just reply to this email.</p>
    `, "👋"),
  });
}

export async function sendRescheduleConfirmation({ to, hostName, oldDate, newDate }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your event has been rescheduled",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">You're moved to ${newDate}, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 14px; text-align: center;">Your event has been rescheduled from ${oldDate} to <strong style="color: ${HEADING};">${newDate}</strong> — no extra charge, and your guest upload link and QR code stay exactly the same.</p>
        ${calloutBox(`
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">Guest uploads and processing deadlines are now measured from your new date. Nothing else about your booking changed.</p>
        `)}
        <p style="font-size: 13px; color: ${MUTED}; margin: 20px 0 0; text-align: center;">If this wasn't you, or you have questions, just reply to this email.</p>
    `, "📅"),
  });
}

export async function sendUploadReminder({ to, hostName, eventDate, uploadUrl, uploadSlug }) {
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}`;

  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your recap starts processing in 24 hours",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">How'd it go, ${hostName.split(" ")[0]}?</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 12px; text-align: center;">Your event on ${eventDate} was yesterday. We'll automatically start putting your recap together in about 24 hours, using whatever photos and videos have been uploaded by then.</p>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center;">If any guests haven't added theirs yet, now's the time to send a reminder — anything uploaded after processing starts won't make it into the final cut.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(qrPageUrl, "Share your QR code again")}
        </p>
        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 0;">
          Or share the guest link directly: <a href="${uploadUrl}" style="color: ${MUTED};">${uploadUrl}</a>
        </p>
    `, "⏳"),
  });
}

export async function sendCustomInquiry({ hostName, email, eventType, eventDate, guestCount, style, notes }) {
  const row = (label, value) =>
    value
      ? `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${value}</td></tr>`
      : "";

  return resend.emails.send({
    from: FROM,
    to: "hello@recappedforyou.com",
    replyTo: email,
    subject: `Custom package inquiry — ${hostName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>New custom package inquiry</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          ${row("Host", hostName)}
          ${row("Email", email)}
          ${row("Event type", eventType)}
          ${row("Event date", eventDate)}
          ${row("Guests", guestCount)}
          ${row("Style preference", STYLE_LABELS[style] || style)}
        </table>
        ${notes ? `<p style="font-size: 14px;"><strong>Notes:</strong> ${notes}</p>` : ""}
        <p style="font-size: 13px; color: #666;">Reply directly to this email to follow up with ${hostName.split(" ")[0]}.</p>
      </div>
    `,
  });
}

export async function sendRoastApprovalRequest({ to, hostName, eventName, reviewUrl }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your Roast Reel script is ready for review 🔥",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">Take a look before it goes out, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center;">We've written the Roast Reel commentary for ${eventName}. Nothing gets shared with your guests until you review and approve it — you can edit any line first.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(reviewUrl, "Review your Roast Reel script")}
        </p>
        <p style="font-size: 13px; color: ${MUTED}; text-align: center; margin: 0;">Your final video won't be finished until you approve this.</p>
    `, "🔥"),
  });
}

export async function sendFailureAlert({ to, failures }) {
  const rows = failures
    .map(
      (f) =>
        `<tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e0d8; font-family: monospace; font-size: 12px;">${f.bookingId}</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e0d8;">${f.error}</td></tr>`
    )
    .join("");

  return resend.emails.send({
    from: FROM,
    to,
    subject: `Recap scheduler: ${failures.length} booking${failures.length === 1 ? "" : "s"} failed`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #211F1D;">
        <h2>${failures.length} booking${failures.length === 1 ? "" : "s"} failed this run</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 6px 8px; border-bottom: 2px solid #211F1D;">Booking</th>
              <th style="text-align: left; padding: 6px 8px; border-bottom: 2px solid #211F1D;">Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size: 13px; color: #666;">These bookings are still sitting unprocessed -- check the GitHub Actions run log for the full stack trace, fix the underlying issue, then re-run the scheduler (or the CLI directly for just that booking) to retry.</p>
      </div>
    `,
  });
}

export async function sendDeliveryNotification({ to, hostName, galleryUrl, expiresDate }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your recap is ready 🎉",
    html: wrapEmail(`
        <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; margin: 0 0 10px; text-align: center;">Your recap is ready, ${hostName.split(" ")[0]}</h2>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center;">Your video and photo gallery are ready to view and download.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(galleryUrl, "View your recap")}
        </p>
        <p style="font-size: 13px; color: ${MUTED}; text-align: center; margin: 0;">This link stays active until ${expiresDate}. Please download anything you'd like to keep before then.</p>
    `, "🎉"),
  });
}
