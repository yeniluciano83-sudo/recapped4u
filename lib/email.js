import { Resend } from "resend";
// Extension is required, not stylistic. scripts/auto-recap.js and
// scripts/poll-and-recap.js are CommonJS and pull this in via
// require("../lib/email"), which makes Node load it as real ESM -- and the
// ESM resolver does not do extensionless resolution. Next's bundler does, so
// an extensionless import here still builds, still passes vitest, and still
// works in every API route, while silently breaking every email the
// schedulers send. It did exactly that: delivery notifications, upload
// reminders and failure alerts all threw inside their catch blocks.
import { generateHostToken } from "./hostToken.js";
import { getUploadLimit } from "./uploadLimits.js";
import { TIER_PRICES, nextUpgradeTier } from "./pricing.js";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = "Recapped For You <hello@recappedforyou.com>";
// Reply-To is attached only when REPLY_TO is set. By default hello@ has no MX
// record (see docs/EMAIL_AUTH.md), so a reply to FROM would bounce -- once
// Cloudflare Email Routing gives it a real inbox, set
// REPLY_TO=hello@recappedforyou.com in the app env and replies start working
// with no code change.
const REPLY_TO = process.env.REPLY_TO;

// resend.emails.send() with our defaults applied: the verified From address,
// plus Reply-To when it's configured. Every template below sends through this.
function send(opts) {
  return resend.emails.send({ from: FROM, ...(REPLY_TO ? { replyTo: REPLY_TO } : {}), ...opts });
}

// WhatsApp is the contact channel shown on the site (see app/page.jsx's Get
// In Touch section); the same number/link is used in these emails.
const WHATSAPP_URL = "https://wa.me/16465129151";
const WHATSAPP_DISPLAY = "+1 (646) 512-9151";

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

// Wraps a template's inner content in the site's actual look: a masthead
// topping a white rounded card, on the site's cream page background, with
// the LLC line beneath it -- mirrors the site's own footer placement,
// outside the card. Georgia for headings (email-safe, matches the site's
// serif; Arial/Helvetica stands in for Inter, which email clients can't
// load).
//
// The masthead badge used to be a different big floating emoji per email
// type (🎬, ✅, 👋, 📅, ⏳, 📸...) -- eight variations of the same "emoji as
// icon" move, none of them meaning anything specific to that email's actual
// content. Replaced with the one real, consistent thing: the site's own nav
// brand mark (the gradient badge from app/page.jsx), so every email reads as
// the same brand's masthead rather than a costume that changes per message.
// A message that genuinely deserves its own icon (the delivery
// notification's celebration) gets one inside its own content instead, tied
// to what that email is actually about.
function wrapEmail(innerHtml) {
  // The color-scheme meta tags + :root CSS alone weren't enough -- confirmed
  // live, a real send to Gmail rendered with the whole background forced to
  // near-black. Gmail's auto-dark-mode heuristic specifically looks for
  // whether an email already ships its own @media (prefers-color-scheme:
  // dark) rule as proof it's already been considered; without one, Gmail
  // inverts a light background on its own regardless of the color-scheme
  // meta declaration (Apple Mail and Outlook do respect that meta alone --
  // this is a Gmail-specific gap). The fix used everywhere in production
  // HTML email (Klaviyo, Mailchimp, etc.) is exactly this: ship a dark-mode
  // block that just re-asserts the same light colors with !important, which
  // satisfies the heuristic and stops Gmail from touching anything else.
  // Classed rather than left purely inline so this one block can target
  // every background-critical region (including the two gradient hero cards
  // defined in other functions below -- CSS classes apply document-wide
  // regardless of which function emits the class attribute).
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>
          :root { color-scheme: light only; supported-color-schemes: light only; }
          @media (prefers-color-scheme: dark) {
            body, .em-bg { background-color: ${BG} !important; }
            .em-card { background-color: ${CARD} !important; }
            .em-tint { background-color: ${TINT} !important; background-image: linear-gradient(160deg, ${TINT} 0%, ${BG} 100%) !important; }
            .em-hero { background-color: ${CORAL} !important; background-image: ${BRIGHT_GRADIENT} !important; }
            .em-heading { color: ${HEADING} !important; }
            .em-body-text { color: ${BODY} !important; }
            .em-muted { color: ${MUTED} !important; }
            .em-faint { color: ${FAINT} !important; }
            .em-sage { color: ${SAGE} !important; }
            .em-bright { color: ${BRIGHT_TEXT} !important; }
          }
        </style>
      </head>
      <body class="em-bg" bgcolor="${BG}" style="margin: 0; padding: 0; background-color: ${BG};">
        <div class="em-bg" bgcolor="${BG}" style="background-color: ${BG}; padding: 44px 16px; font-family: Arial, Helvetica, sans-serif;">
          <div style="max-width: 480px; margin: 0 auto;">
            <div class="em-card" style="background: ${CARD}; border: 1px solid ${BORDER}; border-radius: 22px; overflow: hidden; box-shadow: 0 14px 34px rgba(33,31,29,0.09);">
              <div class="em-tint" style="background-color: ${TINT}; background-image: linear-gradient(160deg, ${TINT} 0%, ${BG} 100%); padding: 30px 28px 24px; text-align: center; border-bottom: 1px solid ${BORDER};">
                <div style="width: 40px; height: 40px; line-height: 40px; margin: 0 auto 12px; border-radius: 12px; background-color: ${ACCENT}; background-image: linear-gradient(135deg, ${ACCENT}, #E0985A); font-size: 18px;">📷</div>
                <p class="em-sage" style="margin: 0; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: ${SAGE}; font-weight: bold;">Recapped For You</p>
              </div>
              <div class="em-card em-heading" style="padding: 32px 28px 30px; color: ${HEADING};">
                ${innerHtml}
              </div>
            </div>
            <p class="em-faint" style="text-align: center; font-size: 11px; color: ${FAINT}; margin: 22px 0 0;">
              Recapped For You LLC, a New York limited liability company.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// A headline plus the site's own "About" section trick underneath it (a
// short accent rule) instead of the headline just floating loose -- the
// same small structural device, borrowed on purpose rather than invented
// fresh for email. ruleColor is overridable for the two hero cards below,
// where the headline sits on a colored gradient and an accent-colored rule
// would vanish against it.
function sectionHeading(text, { color = HEADING, ruleColor = ACCENT, emClass = "em-heading" } = {}) {
  return `
    <h2 class="${emClass}" style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; line-height: 1.3; margin: 0 0 12px; text-align: center; color: ${color};">${text}</h2>
    <div style="width: 40px; height: 3px; background-color: ${ruleColor}; border-radius: 999px; margin: 0 auto 22px;"></div>
  `;
}

function ctaButton(href, label) {
  return `<a href="${href}" style="display: inline-block; background: ${ACCENT}; color: ${HEADING}; padding: 15px 30px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14.5px; box-shadow: 0 6px 18px rgba(201,122,61,0.35);">${label}</a>`;
}

// Left-border accent instead of a plain box all the way around -- the same
// treatment the site's own "About" pull-quote uses, not a generic bordered
// div.
function calloutBox(innerHtml) {
  return `<div class="em-bg" style="background: ${BG}; border: 1px solid ${BORDER}; border-left: 3px solid ${ACCENT}; border-radius: 12px; padding: 20px 22px;">${innerHtml}</div>`;
}

// One icon + label + description row for a scannable details list -- a
// fixed-size square (line-height == height, text-align center) centers the
// emoji without relying on flexbox, which Outlook's Word rendering engine
// ignores.
function detailRow(icon, label, text) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 18px;">
      <tr>
        <td width="36" valign="top" style="padding-right: 13px;">
          <div style="width: 32px; height: 32px; line-height: 32px; border-radius: 10px; background: ${TINT}; text-align: center; font-size: 15px;">${icon}</div>
        </td>
        <td valign="top">
          <p style="margin: 0 0 2px; font-size: 13px; font-weight: 700; color: ${BRIGHT_TEXT};">${label}</p>
          <p style="margin: 0; font-size: 13px; color: ${BODY}; line-height: 1.55;">${text}</p>
        </td>
      </tr>
    </table>
  `;
}

// The same 24-segment reel bar app/event/[eventId]/page.jsx and
// app/qr/[slug]/upload/page.jsx already show a host/guest while uploads are
// live -- carried into email rather than invented fresh, so "212 of 500
// photos" means the same visual thing here as it does on the site itself.
// A <table> of <td>s, not flex/grid (Outlook's Word engine ignores both),
// with a hairline gap between cells the way the site's own CSS `gap` does.
function reelBar(filled, total = 24) {
  const cells = Array.from({ length: total }, (_, i) =>
    `<td style="padding: 0 1px;"><div style="height: 8px; border-radius: 1px; background-color: ${i < filled ? ACCENT : BORDER};"></div></td>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 8px;"><tr>${cells}</tr></table>`;
}

// Display names for stored ids -- keep in sync with the TIERS/STYLES arrays
// in app/booking/page.jsx. Price itself isn't duplicated here; the actual
// amount charged comes from the Stripe session at send time.
const TIER_LABELS = { free: "Free", standard: "Highlight", premium: "Spotlight", keepsake: "Luxe" };
const STYLE_LABELS = { cinematic: "Cinematic", upbeat: "Upbeat", documentary: "Documentary", retro: "Nostalgic / Retro", highlight: "Highlight Reel" };

// Keep in sync with TIER_SCHEDULE in scripts/poll-and-recap.js.
const TIER_DEADLINE_LABELS = { free: "24 hours", standard: "48 hours", premium: "1 week", keepsake: "2 weeks" };
// How long ago the event was, and how long until processing starts, at the
// moment sendUploadReminder actually fires for each tier -- derived from
// the gap between reminderHours and processHours in TIER_SCHEDULE (poll-
// and-recap.js). Free never gets a reminder (reminderHours: null), so it
// has no entry here.
const REMINDER_TIMING = {
  standard: { since: "yesterday", until: "24 hours" },
  premium: { since: "6 days ago", until: "24 hours" },
  keepsake: { since: "a week ago", until: "7 days" },
};
// Keep in sync with GALLERY_EXPIRY_DAYS / GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const TIER_RETENTION_LABELS = { free: "7 days", standard: "2 months", premium: "4 months", keepsake: "6 months" };
// Keep in sync with SOCIAL_CUTS_COUNT in scripts/auto-recap.js.
const SOCIAL_CUTS_COUNT_LABELS = { premium: 5, keepsake: 10 };

export async function sendBookingConfirmation({ to, hostName, eventDate, eventType, guestCount, tier, style, amountPaid, roastEnabled, uploadUrl, uploadSlug, bookingId, deliveryFormat }) {
  // uploadUrl and qrImageUrl stay bare -- those are the guest-facing artifacts
  // and every guest is meant to hold them. The three host links below carry
  // the host token, which is what actually authorizes managing the event;
  // see lib/hostToken.js for why the slug alone can't.
  const hostToken = generateHostToken(bookingId);
  const qrImageUrl = `${process.env.APP_URL}/api/qrcode/${uploadSlug}`;
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}?t=${hostToken}`;
  const cancelUrl = `${process.env.APP_URL}/cancel/${uploadSlug}?t=${hostToken}`;
  const rescheduleUrl = `${process.env.APP_URL}/reschedule/${uploadSlug}?t=${hostToken}`;
  const deadline = TIER_DEADLINE_LABELS[tier] || "the deadline for your package";
  const retention = TIER_RETENTION_LABELS[tier] || "90 days";
  const isSocialEligible = tier === "premium" || tier === "keepsake";
  // "What you'll get" -- previously nowhere in this email, even though it's
  // one of the first things anyone who just paid wants confirmed. Mirrors
  // the same three-way split the site itself describes on the pricing page.
  const whatYoullGet =
    deliveryFormat === "social_cuts"
      ? "Social cuts made from every photo your guests upload, sized for Instagram, TikTok, or Reels — no full video, but every photo guaranteed a spot somewhere."
      : deliveryFormat === "video_only"
      ? "One full recap video — no social cuts."
      : isSocialEligible
      ? `One full recap video, plus ${SOCIAL_CUTS_COUNT_LABELS[tier]} social cuts sized for Instagram, TikTok, or Reels.`
      : "One full recap video.";
  const turnaround = tier === "keepsake" ? "usually ready within 48 hours (priority turnaround)" : "usually ready within a few days";
  // Explicit null/undefined/"" check, not bare truthiness -- a guest count
  // of exactly 0 is a real, entered value (a solo/self-only event), not a
  // missing one, and shouldn't silently vanish from the summary the way an
  // actually-unset field should.
  const summaryRow = (label, value) =>
    value !== null && value !== undefined && value !== ""
      ? `<tr><td style="padding: 8px 0; color: rgba(255,255,255,0.82); font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,0.2);">${label}</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: #FFFFFF; font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,0.2);">${value}</td></tr>`
      : "";

  return send({
    to,
    subject: "You're booked — here's your guest QR code",
    html: wrapEmail(`
        ${sectionHeading(`You're all set, ${hostName.split(" ")[0]}`, { color: BRIGHT_TEXT, emClass: "em-bright" })}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 22px; text-align: center; color: ${BRIGHT_TEXT};">Your event on ${eventDate} is booked. Share the QR code below with your guests so they can add their photos.</p>

        <div class="em-hero" style="background-color: ${CORAL}; background-image: ${BRIGHT_GRADIENT}; border-radius: 18px; padding: 26px 22px;">
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
            <a href="${qrPageUrl}" style="display: inline-block; background: #FFFFFF; color: ${CORAL}; padding: 14px 26px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.15);">Access your host page</a>
          </p>
        </div>

        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 16px 0 26px;">
          Or share the guest link directly: <a href="${uploadUrl}" style="color: ${MUTED};">${uploadUrl}</a>
        </p>

        <h3 style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; margin: 0 0 14px; color: ${BRIGHT_TEXT};">The details</h3>
        ${calloutBox(`
          ${detailRow("🎬", "What you'll get", `${whatYoullGet} Every photo your guests upload also lands in your photo gallery. Recaps are ${turnaround}.`)}
          ${detailRow("📤", "Guest uploads", `Open for ${deadline} after your event — anything after that won't make the cut. Add your own photos or close uploads early from your QR share page above.`)}
          ${detailRow("⭐", "Star your favorites", `Once guests start uploading, star any must-include photos from your QR share page to guarantee they make the video${isSocialEligible && deliveryFormat !== "video_only" ? " — social cuts get their own separate star picks too" : ""}, even if our automatic picks would've skipped them.`)}
          ${detailRow("⏳", "Delivery & retention", `Your recap arrives by email and stays accessible for ${retention} after delivery, then it's permanently removed. Raw guest uploads are deleted 30 days after final delivery.`)}
          ${roastEnabled ? detailRow("🔥", "Roast Reel", "Witty commentary layered over your recap video, plus a caption-free version alongside it. Social cuts aren't captioned — they play at the normal pace either way.") : ""}
          ${tier === "keepsake" ? detailRow("⏱️", "Need more time?", "Luxe includes a one-time 2-day deadline extension — use it anytime before your uploads close, right from your QR share page.") : ""}
          ${detailRow("💳", "Cancellations", "Cancelling more than 24 hours before your event gets you a full refund. Cancelling inside 24 hours isn't eligible, since guest uploads may already be underway.")}
          ${detailRow("📅", "Need a new date?", "Reschedule for free up to 24 hours before your event, as long as your recap hasn't started processing yet — right from the link below. Your QR code and upload link stay the same.")}
          ${detailRow("🔒", "Your privacy", "Photos are used only to produce this recap — never sold, shared, or used for advertising.")}
        `)}

        <p style="font-size: 12px; color: ${FAINT}; margin: 20px 0 0;">
          By completing your booking and payment, you agreed to these terms. <a href="${rescheduleUrl}" style="color: ${FAINT};">Reschedule</a> or <a href="${cancelUrl}" style="color: ${FAINT};">cancel your booking</a>. Questions? Message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${FAINT};">${WHATSAPP_DISPLAY}</a>.
        </p>
    `),
  });
}

export async function sendConfirmBookingEmail({ to, hostName, eventDate, eventType, confirmUrl }) {
  return send({
    to,
    subject: "Confirm your free recap",
    html: wrapEmail(`
        ${sectionHeading(`One click to activate, ${hostName.split(" ")[0]}`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 22px; text-align: center;">Someone requested a free recap for a ${eventType} on ${eventDate} using this email address. Confirm it's you to activate the guest upload link and QR code.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(confirmUrl, "Confirm this booking")}
        </p>
        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 0 0 22px;">If you didn't request this, you can safely ignore this email — nothing goes live until this link is clicked.</p>
        ${calloutBox(`
          ${detailRow("1️⃣", "Confirm it's you", "Click the button above.")}
          ${detailRow("2️⃣", "Get your QR code", "A second email arrives immediately with your guest QR code, upload link, and everything else about your event.")}
        `)}
    `),
  });
}

// refunded/amountRefunded reflect what actually happened; tier and
// refundEligible are passed alongside them so the non-refund message can say
// the real reason instead of a single hard-coded guess. !refunded happens for
// three genuinely different reasons -- a Free booking (nothing was ever
// charged), a paid booking cancelled inside the 24-hour window (the real
// "too late" case the old copy always claimed), or a paid, timing-eligible
// booking whose refund itself failed to process (a Stripe/data issue, not a
// timing one) -- and conflating them told a host who cancelled a free
// booking weeks out that they'd cancelled too late, which was simply false.
// Staff-only replacement for "copy this checkout link and text it to the
// host yourself" -- app/api/admin/custom-quote/route.js calls this the
// moment a custom-priced booking is created, so the host gets a real,
// branded email with the payment link immediately, the same way every other
// booking path (free confirm, self-service upgrade) already emails its own
// link rather than leaving that step to whoever's at the dashboard
// remembering to paste it somewhere. The checkout link itself still shows in
// the dashboard too, for a host staff would rather reach directly (a phone
// call, WhatsApp) instead of waiting on an inbox.
export async function sendCustomQuoteEmail({ to, hostName, eventType, eventDate, tier, amount, checkoutUrl, label, description }) {
  const tierLabel = TIER_LABELS[tier] || tier;
  const planName = label?.trim() || `${tierLabel}-based custom plan`;

  return send({
    to,
    subject: "Your custom Recapped For You plan is ready",
    html: wrapEmail(`
        ${sectionHeading(`Your plan is ready, ${hostName.split(" ")[0]}`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 22px; text-align: center;">We put together a custom plan for ${eventType} on ${eventDate}. Complete payment below and your guest upload link and QR code go live right away.</p>
        ${calloutBox(`
          ${detailRow("📋", "Plan", planName)}
          ${detailRow("💵", "Price", amount)}
          ${description?.trim() ? detailRow("📝", "Details", description.trim()) : ""}
        `)}
        <p style="margin: 22px 0 16px; text-align: center;">
          ${ctaButton(checkoutUrl, "Complete your booking")}
        </p>
        <p style="font-size: 13px; color: ${MUTED}; margin: 0; text-align: center;">Questions about this plan? Message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${MUTED};">${WHATSAPP_DISPLAY}</a>.</p>
    `),
  });
}

export async function sendCancellationConfirmation({ to, hostName, eventType, eventDate, tier, refunded, refundEligible, amountRefunded }) {
  const noRefundReason =
    tier === "free"
      ? "This was a free booking, so there was nothing to refund."
      : refundEligible
      ? `Your refund couldn't be processed automatically — message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${BRIGHT_TEXT}; font-weight: 700;">${WHATSAPP_DISPLAY}</a> and we'll take care of it.`
      : "This cancellation was made within 24 hours of the event, so it's not eligible for a refund per our cancellation policy.";

  return send({
    to,
    subject: "Your booking has been cancelled",
    html: wrapEmail(`
        ${sectionHeading(`Your booking is cancelled, ${hostName.split(" ")[0]}`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 18px; text-align: center;">Your ${eventType} on ${eventDate} has been cancelled and the guest upload link is now closed — no one can add photos to it anymore.</p>
        ${calloutBox(`
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">${
            refunded
              ? `A full refund of ${amountRefunded} has been issued to your original payment method. It may take a few business days to appear.`
              : noRefundReason
          }</p>
        `)}
        <p style="font-size: 13.5px; color: ${MUTED}; line-height: 1.6; margin: 20px 0 0; text-align: center;">Hope to be part of whatever you're celebrating next — <a href="${process.env.APP_URL}/booking" style="color: ${SAGE}; font-weight: 600;">book again</a> anytime.</p>
        <p style="font-size: 13px; color: ${MUTED}; margin: 12px 0 0; text-align: center;">If this wasn't you, or you have questions, message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${MUTED};">${WHATSAPP_DISPLAY}</a>.</p>
    `),
  });
}

export async function sendRescheduleConfirmation({ to, hostName, oldDate, newDate }) {
  // A struck-through old date beside the new one, not just a sentence
  // saying "from X to Y" -- reads the way an actual calendar update would,
  // at a glance, before the paragraph beneath it even needs reading. Its
  // own plain card (not calloutBox's left-accent stripe) -- that stripe
  // signals "note", this is a data widget, a different thing to look at.
  const dateCard = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="margin: 0 0 20px; border: 1px solid ${BORDER}; border-radius: 12px; background: ${CARD};">
      <tr>
        <td width="50%" style="text-align: center; padding: 16px 8px; border-right: 1px solid ${BORDER};">
          <p style="margin: 0 0 4px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${FAINT}; font-weight: 700;">Was</p>
          <p style="margin: 0; font-size: 15px; color: ${FAINT}; text-decoration: line-through;">${oldDate}</p>
        </td>
        <td width="50%" style="text-align: center; padding: 16px 8px;">
          <p style="margin: 0 0 4px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: ${SAGE}; font-weight: 700;">Now</p>
          <p style="margin: 0; font-size: 15px; font-weight: 700; color: ${HEADING};">${newDate}</p>
        </td>
      </tr>
    </table>
  `;

  return send({
    to,
    subject: "Your event has been rescheduled",
    html: wrapEmail(`
        ${sectionHeading(`You're moved to ${newDate}, ${hostName.split(" ")[0]}`)}
        ${dateCard}
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 18px; text-align: center;">No extra charge, and your guest upload link and QR code stay exactly the same.</p>
        ${calloutBox(`
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">Guest uploads and processing deadlines are now measured from your new date. Nothing else about your booking changed.</p>
        `)}
        <p style="font-size: 13px; color: ${MUTED}; margin: 20px 0 0; text-align: center;">If this wasn't you, or you have questions, message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${MUTED};">${WHATSAPP_DISPLAY}</a>.</p>
    `),
  });
}

export async function sendUploadReminder({ to, hostName, eventDate, uploadUrl, uploadSlug, bookingId, tier, uploadCount }) {
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}?t=${generateHostToken(bookingId)}`;
  const timing = REMINDER_TIMING[tier] || REMINDER_TIMING.standard;
  // uploadCount is optional -- older call sites (or a future one) that don't
  // pass it still get a perfectly fine email, just without this section.
  const cap = getUploadLimit(tier);
  const countLine =
    typeof uploadCount === "number"
      ? `${reelBar(Math.min(24, Math.round((uploadCount / cap) * 24)))}
         <p style="font-size: 13px; color: ${MUTED}; margin: 0 0 16px; text-align: center;"><strong style="color: ${HEADING};">${uploadCount}</strong> of ${cap} photos uploaded so far.</p>`
      : "";

  return send({
    to,
    subject: `Your recap starts processing in ${timing.until}`,
    html: wrapEmail(`
        ${sectionHeading(`How'd it go, ${hostName.split(" ")[0]}?`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 12px; text-align: center;">Your event on ${eventDate} was ${timing.since}. We'll automatically start putting your recap together in about ${timing.until}, using whatever photos have been uploaded by then.</p>
        ${countLine}
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 22px; text-align: center;">If any guests haven't added theirs yet, now's the time to send a reminder — anything uploaded after processing starts won't make it into the final cut.</p>
        <p style="margin: 0 0 16px; text-align: center;">
          ${ctaButton(qrPageUrl, "Share your QR code again")}
        </p>
        <p style="font-size: 12.5px; color: ${MUTED}; text-align: center; margin: 0;">
          Or share the guest link directly: <a href="${uploadUrl}" style="color: ${MUTED};">${uploadUrl}</a>
        </p>
    `),
  });
}

// Sent once per "fill" -- app/api/events/[eventId]/upload/confirm/route.js
// fires this the moment an upload brings the event's count to exactly its
// tier's cap (lib/uploadLimits.js), guarded by bookings.upload_cap_notified_at
// so a flood of subsequently-rejected guest uploads doesn't re-send it. That
// flag resets on a delete (see the DELETE handler on
// app/api/events/[eventId]/uploads/[uploadId]/route.js), so a host who frees
// room and re-fills the event gets notified again rather than silenced
// forever after the first time.
//
// Every tier gets this, including Free -- for Free specifically, the cap
// (20) is the same number as its curated gallery size, so reaching it means
// the gallery itself is full, not just an anti-abuse ceiling being probed.
export async function sendUploadCapReachedEmail({ to, hostName, eventType, tier, uploadSlug, bookingId }) {
  const hostToken = generateHostToken(bookingId);
  const qrPageUrl = `${process.env.APP_URL}/qr/${uploadSlug}?t=${hostToken}`;
  const cap = getUploadLimit(tier);
  const tierLabel = TIER_LABELS[tier] || tier;

  // null on Spotlight/Luxe -- they already share the top 2000-photo cap, so
  // there's no self-service tier left that would actually help (see
  // nextUpgradeTier in lib/pricing.js). An event that size doesn't need a
  // bigger *tier*, it needs a custom arrangement -- exactly what
  // app/api/admin/custom-quote/route.js already exists for, just not
  // previously offered to a host who hits this specific wall. The
  // pre-filled WhatsApp message means whoever answers already has the
  // context (which event, which tier, already full) instead of the host
  // having to explain it from scratch.
  const upgradeTier = nextUpgradeTier(tier);
  const customTierUrl = `${WHATSAPP_URL}?text=${encodeURIComponent(
    `Hi! ${eventType} just hit the ${cap}-photo limit on ${tierLabel} and I'd like to talk about a custom plan with more room.`
  )}`;
  const upgradeRow = upgradeTier
    ? `<p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;"><strong style="color: ${HEADING};">Want more room without deleting anything?</strong> Upgrade to ${TIER_LABELS[upgradeTier]} for <a href="${process.env.APP_URL}/api/events/${uploadSlug}/upgrade?t=${hostToken}" style="color: ${BRIGHT_TEXT}; font-weight: 700;">+$${((TIER_PRICES[upgradeTier].amount - TIER_PRICES[tier].amount) / 100).toFixed(0)} more</a> and get up to ${getUploadLimit(upgradeTier)} photos.</p>`
    : `<p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;"><strong style="color: ${HEADING};">Already on our biggest plan?</strong> ${eventType} is clearly a big one — <a href="${customTierUrl}" style="color: ${BRIGHT_TEXT}; font-weight: 700;">message us on WhatsApp</a> and we'll work out a custom plan sized for it.</p>`;

  return send({
    to,
    subject: `You've hit ${eventType}'s upload limit`,
    html: wrapEmail(`
        ${sectionHeading(`You're full, ${hostName.split(" ")[0]}!`)}
        ${reelBar(24)}
        <p style="font-size: 13px; color: ${MUTED}; margin: 0 0 18px; text-align: center;"><strong style="color: ${HEADING};">${cap}</strong> of ${cap} photos uploaded — completely full.</p>
        <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 18px; text-align: center;">${eventType} just reached the ${tierLabel} plan's limit of ${cap} photos. From here, any guest who tries to add another will see a message that the event is full — nothing breaks, but new uploads stop landing.</p>
        ${calloutBox(`
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0 0 10px;"><strong style="color: ${HEADING};">Need more room?</strong> Delete a few photos from your share page below and guests can pick right back up where they left off.</p>
          <p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0 0 10px;"><strong style="color: ${HEADING};">Got everything you need?</strong> Close uploads now instead of waiting for your deadline, and we'll start putting your recap together right away.</p>
          ${upgradeRow}
        `)}
        <p style="margin: 20px 0 0; text-align: center;">
          ${ctaButton(qrPageUrl, "Manage your photos")}
        </p>
    `),
  });
}

// Sent from the Stripe webhook the moment an upgrade payment actually
// completes (see app/api/events/[eventId]/upgrade/route.js and the
// upgrade_to_tier branch in app/api/webhooks/stripe/route.js) -- confirms
// the new limit is live, not just that the charge went through.
export async function sendUpgradeConfirmation({ to, hostName, newTier }) {
  const newCap = getUploadLimit(newTier);
  const newTierLabel = TIER_LABELS[newTier] || newTier;

  return send({
    to,
    subject: `You're upgraded to ${newTierLabel}`,
    html: wrapEmail(`
        ${sectionHeading(`You're upgraded, ${hostName.split(" ")[0]}!`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 18px; text-align: center;">Your event is now on the ${newTierLabel} plan, with room for up to <strong style="color: ${HEADING};">${newCap}</strong> photos.</p>
        ${calloutBox(`<p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">Guests can pick up right where they left off — your guest upload link, QR code, and everything else about your event stays exactly the same.</p>`)}
        <p style="font-size: 13px; color: ${MUTED}; margin: 20px 0 0; text-align: center;">Questions? Message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${MUTED};">${WHATSAPP_DISPLAY}</a>.</p>
    `),
  });
}

// A staff-initiated dashboard edit (the Package section of
// app/dashboard/page.jsx's DetailPanel, via app/api/bookings/[id]/route.js's
// PATCH), opt-in the same way sendRescheduleConfirmation's own
// notifyReschedule flag already is -- a plain correction (fixing a
// mis-entered tier, comping a price the host already knows about from a
// phone call) shouldn't always blast an email, so this only fires when
// staff explicitly checks the box. Deliberately distinct from
// sendUpgradeConfirmation just above: that one is the self-service,
// Stripe-paid upgrade flow's own confirmation and always implies a real
// charge just went through; a staff edit isn't necessarily a transaction at
// all (could be a downgrade, a comp, a correction), so this carries no
// payment framing.
export async function sendBookingUpdateConfirmation({ to, hostName, tier, customPriceCents }) {
  const tierLabel = TIER_LABELS[tier] || tier;
  const cap = getUploadLimit(tier);
  const priceLine =
    customPriceCents != null
      ? `<p style="font-size: 14px; color: ${BODY}; line-height: 1.6; margin: 0;">Your custom price is now <strong style="color: ${HEADING};">${new Intl.NumberFormat("en-US", { style: "currency", currency: "usd" }).format(customPriceCents / 100)}</strong>.</p>`
      : "";

  return send({
    to,
    subject: "Your Recapped For You plan has been updated",
    html: wrapEmail(`
        ${sectionHeading(`Your plan's been updated, ${hostName.split(" ")[0]}`)}
        <p style="font-size: 14.5px; line-height: 1.6; margin: -8px 0 18px; text-align: center;">Your event is now on the ${tierLabel} plan, with room for up to <strong style="color: ${HEADING};">${cap}</strong> photos.</p>
        ${priceLine ? calloutBox(priceLine) : ""}
        <p style="font-size: 13.5px; color: ${MUTED}; line-height: 1.6; margin: 20px 0 0; text-align: center;">Guests can pick up right where they left off — your guest upload link, QR code, and everything else about your event stays exactly the same.</p>
        <p style="font-size: 13px; color: ${MUTED}; margin: 12px 0 0; text-align: center;">Questions? Message us on WhatsApp: <a href="${WHATSAPP_URL}" style="color: ${MUTED};">${WHATSAPP_DISPLAY}</a>.</p>
    `),
  });
}

// Staff-facing, not a customer template -- same plain, unbranded treatment
// as sendFailureAlert below, since nobody needs the site's own visual
// identity reflected back at them in their own inbox. Fired from both
// places a booking actually goes live -- the Stripe webhook (paid tiers)
// and the free-tier email-confirmation route -- each gated on
// BOOKING_ALERT_EMAIL being set, so this stays opt-in rather than mailing
// nobody-in-particular by default the way ADMIN_ALERT_EMAIL already works
// for render failures in scripts/poll-and-recap.js.
export async function sendNewBookingAlert({ to, hostName, email, eventType, eventDate, tier, guestCount, amountPaid, bookingId }) {
  const tierLabel = TIER_LABELS[tier] || tier;
  const rows = [
    ["Host", hostName],
    ["Email", email],
    ["Event", eventType],
    ["Date", eventDate],
    ["Tier", tierLabel],
    ["Guests", guestCount ?? "—"],
    ["Paid", amountPaid],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e0d8; color: #666;">${label}</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e0d8; font-weight: 600;">${value}</td></tr>`
    )
    .join("");

  return send({
    to,
    subject: `New booking: ${hostName} — ${eventType} (${tierLabel})`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #211F1D;">
        <h2 style="margin: 0 0 14px;">New booking</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">${rows}</table>
        <p style="font-size: 12px; color: #999; font-family: monospace; margin: 16px 0 0;">Booking ID: ${bookingId}</p>
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

  return send({
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
        <p style="font-size: 13px; color: #666;">These bookings are still sitting unprocessed — check the GitHub Actions run log for the full stack trace, fix the underlying issue, then re-run the scheduler (or the CLI directly for just that booking) to retry.</p>
      </div>
    `,
  });
}

// The one email that's the actual payoff of the whole product -- previously
// wrapped in the exact same plain masthead as every other message here, with
// no mention of what was actually delivered. Bookends the journey: the
// booking-confirmation email above gets the site's own warm gradient hero
// treatment for the QR code (the start), this gets the same treatment for
// the finished recap (the end) -- mirrors /booking/success's confetti
// moment rather than inventing a new celebratory language for email.
export async function sendDeliveryNotification({ to, hostName, galleryUrl, expiresDate, hasFullVideo, socialCutCount }) {
  // hasFullVideo/socialCutCount are optional -- scripts/resend-delivery-email.js
  // re-sending an older booking, or any future call site that doesn't have
  // them handy, still gets a perfectly fine, just less specific, email.
  const whatsIncluded =
    typeof hasFullVideo !== "boolean"
      ? "Your video and photo gallery are ready to view and download."
      : hasFullVideo && socialCutCount > 0
      ? `Your full recap video, ${socialCutCount} social cut${socialCutCount === 1 ? "" : "s"}, and your full photo gallery are all ready.`
      : hasFullVideo
      ? "Your full recap video and photo gallery are ready."
      : socialCutCount > 0
      ? `${socialCutCount} social cut${socialCutCount === 1 ? "" : "s"} and your full photo gallery are ready.`
      : "Your photo gallery is ready.";

  return send({
    to,
    subject: "Your recap is ready 🎉",
    html: wrapEmail(`
        <div class="em-hero" style="background-color: ${CORAL}; background-image: ${BRIGHT_GRADIENT}; border-radius: 18px; padding: 34px 26px; text-align: center;">
          <div style="width: 56px; height: 56px; line-height: 56px; margin: 0 auto 16px; border-radius: 16px; background: rgba(255,255,255,0.24); font-size: 26px;">🎉</div>
          <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 25px; line-height: 1.3; margin: 0 0 10px; color: #FFFFFF;">Your recap is ready, ${hostName.split(" ")[0]}</h2>
          <p style="font-size: 14.5px; line-height: 1.6; margin: 0 0 24px; color: rgba(255,255,255,0.92);">${whatsIncluded}</p>
          <a href="${galleryUrl}" style="display: inline-block; background: #FFFFFF; color: ${CORAL}; padding: 15px 30px; border-radius: 999px; text-decoration: none; font-weight: bold; font-size: 14.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.18);">View your recap</a>
        </div>
        <p style="font-size: 13px; color: ${MUTED}; text-align: center; margin: 22px 0 0;">This link stays active until ${expiresDate}. Please download anything you'd like to keep before then.</p>
    `),
  });
}
