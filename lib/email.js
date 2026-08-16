import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Recapped For You <hello@recappedforyou.com>"; // switch to hello@recappedforyou.com once domain is verified in Resend

// Display names for stored ids -- keep in sync with the TIERS/STYLES arrays
// in app/booking/page.jsx. Price itself isn't duplicated here; the actual
// amount charged comes from the Stripe session at send time.
const TIER_LABELS = { free: "Free", standard: "Classic", premium: "Signature", keepsake: "Luxe" };
const STYLE_LABELS = { cinematic: "Cinematic", upbeat: "Upbeat", documentary: "Documentary", retro: "Nostalgic / Retro", highlight: "Highlight Reel" };

export async function sendBookingConfirmation({ to, hostName, eventDate, eventType, guestCount, tier, style, amountPaid, uploadUrl, uploadSlug }) {
  const qrImageUrl = `${process.env.APP_URL}/api/qrcode/${uploadSlug}`;
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}`;
  const summaryRow = (label, value) =>
    value
      ? `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${value}</td></tr>`
      : "";

  return resend.emails.send({
    from: FROM,
    to,
    subject: "You're booked — here's your guest QR code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>You're all set, ${hostName.split(" ")[0]}</h2>
        <p>Your event on ${eventDate} is booked. Share the QR code below with your guests so they can add their photos and videos.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; padding: 16px; background: #f7f3ec; border-radius: 8px; font-size: 14px;">
          ${summaryRow("Package", TIER_LABELS[tier] || tier)}
          ${summaryRow("Amount paid", amountPaid)}
          ${summaryRow("Event", eventType)}
          ${summaryRow("Date", eventDate)}
          ${summaryRow("Guests", guestCount)}
          ${summaryRow("Editing style", STYLE_LABELS[style] || style)}
        </table>
        <p style="margin: 24px 0; text-align: center;">
          <img src="${qrImageUrl}" alt="Guest upload QR code" width="220" height="220" style="border-radius: 8px; border: 1px solid #ddd;" />
        </p>
        <p style="margin: 24px 0; text-align: center;">
          <a href="${qrPageUrl}" style="background:#C97A3D; color:#211F1D; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
            Share or print your QR code
          </a>
        </p>
        <p style="font-size: 13px; color: #666; text-align: center;">
          Or share the guest link directly: <a href="${uploadUrl}">${uploadUrl}</a>
        </p>
        <p style="font-size: 13px; color: #666;">We'll email you again once your recap is ready to view.</p>
      </div>
    `,
  });
}

export async function sendUploadReminder({ to, hostName, eventDate, uploadUrl, uploadSlug }) {
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}`;

  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your recap starts processing in 24 hours",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>How'd it go, ${hostName.split(" ")[0]}?</h2>
        <p>Your event on ${eventDate} was yesterday. We'll automatically start putting your recap together in about 24 hours, using whatever photos and videos have been uploaded by then.</p>
        <p>If any guests haven't added theirs yet, now's the time to send a reminder -- anything uploaded after processing starts won't make it into the final cut.</p>
        <p style="margin: 24px 0; text-align: center;">
          <a href="${qrPageUrl}" style="background:#C97A3D; color:#211F1D; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
            Share your QR code again
          </a>
        </p>
        <p style="font-size: 13px; color: #666; text-align: center;">
          Or share the guest link directly: <a href="${uploadUrl}">${uploadUrl}</a>
        </p>
      </div>
    `,
  });
}

export async function sendRoastApprovalRequest({ to, hostName, eventName, reviewUrl }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your Roast Reel script is ready for review 🔥",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>Take a look before it goes out, ${hostName.split(" ")[0]}</h2>
        <p>We've written the Roast Reel commentary for ${eventName}. Nothing gets shared with your guests until you review and approve it -- you can edit any line first.</p>
        <p style="margin: 24px 0; text-align: center;">
          <a href="${reviewUrl}" style="background:#C97A3D; color:#211F1D; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
            Review your Roast Reel script
          </a>
        </p>
        <p style="font-size: 13px; color: #666;">Your final video won't be finished until you approve this.</p>
      </div>
    `,
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
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>Your recap is ready, ${hostName.split(" ")[0]}</h2>
        <p>Your video and photo gallery are ready to view and download.</p>
        <p style="margin: 24px 0;">
          <a href="${galleryUrl}" style="background:#C97A3D; color:#211F1D; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
            View your recap
          </a>
        </p>
        <p style="font-size: 13px; color: #666;">This link stays active until ${expiresDate}. Please download anything you'd like to keep before then.</p>
      </div>
    `,
  });
}
