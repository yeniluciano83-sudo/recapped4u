import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Recapped For You <onboarding@resend.dev>"; // switch to hello@recappedforyou.com once domain is verified in Resend

export async function sendBookingConfirmation({ to, hostName, eventDate, uploadUrl, uploadSlug }) {
  const qrImageUrl = `${process.env.APP_URL}/api/qrcode/${uploadSlug}`;

  return resend.emails.send({
    from: FROM,
    to,
    subject: "You're booked — here's your guest QR code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2>You're all set, ${hostName.split(" ")[0]}</h2>
        <p>Your event on ${eventDate} is booked. Share the QR code below (or the link) with your guests so they can add their photos and videos — print it, display it on a screen, or share it however's easiest.</p>
        <p style="margin: 24px 0; text-align: center;">
          <img src="${qrImageUrl}" alt="Guest upload QR code" width="220" height="220" style="border-radius: 8px; border: 1px solid #ddd;" />
        </p>
        <p style="margin: 24px 0;">
          <a href="${uploadUrl}" style="background:#C97A3D; color:#211F1D; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
            Or open the guest upload link
          </a>
        </p>
        <p style="font-size: 13px; color: #666;">We'll email you again once your recap is ready to view.</p>
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
