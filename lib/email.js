import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Recapped For You <hello@recappedforyou.com>"; // switch to hello@recappedforyou.com once domain is verified in Resend

// Display names for stored ids -- keep in sync with the TIERS/STYLES arrays
// in app/booking/page.jsx. Price itself isn't duplicated here; the actual
// amount charged comes from the Stripe session at send time.
const TIER_LABELS = { free: "Free", standard: "Classic", premium: "Signature", keepsake: "Luxe" };
const STYLE_LABELS = { cinematic: "Cinematic", upbeat: "Upbeat", documentary: "Documentary", retro: "Nostalgic / Retro", highlight: "Highlight Reel" };

// Keep in sync with TIER_SCHEDULE in scripts/poll-and-recap.js.
const TIER_DEADLINE_LABELS = { free: "24 hours", standard: "48 hours", premium: "1 week", keepsake: "2 weeks" };
// Keep in sync with GALLERY_EXPIRY_DAYS / GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const TIER_RETENTION_LABELS = {
  free: "7 days as an interactive gallery, then downloadable through day 30 -- after that your photos and video are permanently removed",
  standard: "2 months",
  premium: "4 months",
  keepsake: "6 months",
};

export async function sendBookingConfirmation({ to, hostName, eventDate, eventType, guestCount, tier, style, amountPaid, uploadUrl, uploadSlug }) {
  const qrImageUrl = `${process.env.APP_URL}/api/qrcode/${uploadSlug}`;
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}`;
  const cancelUrl = `${process.env.APP_URL}/cancel/${uploadSlug}`;
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
        <p style="font-size: 12px; color: #999; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
          Need to cancel? Cancellations more than 24 hours before your event get a full refund.
          <a href="${cancelUrl}" style="color: #999;">Cancel your booking</a>.
        </p>
      </div>
    `,
  });
}

export async function sendServiceAgreement({ to, hostName, eventDate, eventType, tier, amountPaid, roastEnabled, uploadSlug }) {
  const cancelUrl = `${process.env.APP_URL}/cancel/${uploadSlug}`;
  const deadline = TIER_DEADLINE_LABELS[tier] || "the deadline for your package";
  const retention = TIER_RETENTION_LABELS[tier] || "90 days";
  const row = (label, value) =>
    value
      ? `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${value}</td></tr>`
      : "";

  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your Recapped For You service agreement",
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #211F1D;">
        <h2>Service agreement</h2>
        <p>This confirms the terms of your booking with Recapped For You, ${hostName.split(" ")[0]}.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; padding: 16px; background: #f7f3ec; border-radius: 8px; font-size: 14px;">
          ${row("Package", TIER_LABELS[tier] || tier)}
          ${row("Event", eventType)}
          ${row("Date", eventDate)}
          ${row("Amount paid", amountPaid)}
        </table>

        <h3 style="font-size: 15px; margin-bottom: 4px;">Uploads &amp; deadline</h3>
        <p style="font-size: 14px; color: #333; line-height: 1.6;">Your guests can upload photos and video for ${deadline} after your event, or until you close uploads early from your QR share page. Anything uploaded after that point won't be included in your recap.</p>

        <h3 style="font-size: 15px; margin-bottom: 4px;">Delivery &amp; retention</h3>
        <p style="font-size: 14px; color: #333; line-height: 1.6;">Your recap video and photo gallery will be delivered by email. They stay accessible for ${retention} after delivery. Raw guest uploads are permanently deleted 30 days after final delivery.</p>

        ${roastEnabled ? `
        <h3 style="font-size: 15px; margin-bottom: 4px;">Roast Reel add-on</h3>
        <p style="font-size: 14px; color: #333; line-height: 1.6;">You've added the Roast Reel add-on. Nothing is shared with your guests until you've reviewed and approved the full script by email.</p>
        ` : ""}

        <h3 style="font-size: 15px; margin-bottom: 4px;">Cancellations &amp; refunds</h3>
        <p style="font-size: 14px; color: #333; line-height: 1.6;">You may cancel any time before your event. Cancelling more than 24 hours before your event date gets a full refund; cancelling within 24 hours is not eligible for a refund, since guest uploads may already be underway. Cancel anytime from <a href="${cancelUrl}">your cancellation link</a>.</p>

        <h3 style="font-size: 15px; margin-bottom: 4px;">Use of your content</h3>
        <p style="font-size: 14px; color: #333; line-height: 1.6;">Photos and videos submitted by you and your guests are used only to produce your event's recap. We never sell, share, or use them for advertising.</p>

        <p style="font-size: 12px; color: #999; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
          By completing your booking and payment, you agreed to these terms. Questions? Just reply to this email.
        </p>
      </div>
    `,
  });
}

export async function sendCancellationConfirmation({ to, hostName, eventDate, refunded, amountRefunded }) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: "Your booking has been cancelled",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>Your booking is cancelled, ${hostName.split(" ")[0]}</h2>
        <p>Your event on ${eventDate} has been cancelled and the guest upload link is now closed.</p>
        <p>${
          refunded
            ? `A full refund of ${amountRefunded} has been issued to your original payment method. It may take a few business days to appear.`
            : "This cancellation was made within 24 hours of the event, so it's not eligible for a refund per our cancellation policy."
        }</p>
        <p style="font-size: 13px; color: #666;">If this wasn't you, or you have questions, just reply to this email.</p>
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
