export const metadata = {
  title: "Privacy Policy — Recapped For You",
  description: "How Recapped For You collects, uses, stores, and deletes your data.",
};

const HEADING = "#211F1D";
const BODY = "#4a4642";
const MUTED = "#6b655c";
const ACCENT = "#C97A3D";
const BORDER = "#E4DED2";

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, color: HEADING, margin: "0 0 10px" }}>{title}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.7, color: BODY }}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: HEADING, fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "56px 20px 80px" }}>
        <a href="/" style={{ fontSize: 12.5, color: ACCENT, fontWeight: 600, textDecoration: "none" }}>← Back to Recapped For You</a>

        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "24px 0 8px" }}>Privacy Policy</p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 32, margin: "0 0 8px", lineHeight: 1.15 }}>How we handle your data</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 4px" }}>Last updated August 2026</p>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px" }}>Recapped For You LLC, a New York limited liability company, operates this site and the services described here.</p>

        <div style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px", marginBottom: 36 }}>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.6 }}>
            This page is a plain-language summary of what our systems actually do, kept in sync with how the product is built. It isn't a substitute for legal advice — if you need something formally reviewed by counsel, treat this as a starting point, not a finished legal document.
          </p>
        </div>

        <Section title="What we collect">
          <p><strong style={{ color: HEADING }}>From the person booking:</strong> name, email address, event type and date, optional guest count, and any notes or style preferences you give us in the booking form.</p>
          <p><strong style={{ color: HEADING }}>From event guests:</strong> the photos and videos they upload via the QR code or link, and optionally the name they enter so we know who to thank.</p>
          <p><strong style={{ color: HEADING }}>Payment:</strong> card details are entered directly on Stripe's own hosted checkout page. We never see or store your card number — our servers only receive a payment confirmation from Stripe.</p>
        </Section>

        <Section title="How we use it">
          <p>To build your recap video and photo gallery, send booking/upload confirmations and reminders, process payment and refunds, and follow up on custom package inquiries. We don't use your photos, videos, or contact details for advertising, and we don't sell them.</p>
        </Section>

        <Section title="Who we share it with">
          <p>We use a small set of service providers to run the product, each only for the specific job they do:</p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>Stripe — payment processing and refunds</li>
            <li>Resend — sending booking, reminder, and delivery emails</li>
            <li>Cloudflare — storing uploaded photos and videos</li>
            <li>Supabase — hosting the database that tracks bookings and uploads</li>
          </ul>
          <p style={{ marginTop: 8 }}>None of these providers get to use your data for their own purposes — they only process it on our behalf.</p>
        </Section>

        <Section title="How long we keep it">
          <p><strong style={{ color: HEADING }}>Raw guest uploads</strong> (the original photos/videos guests submit) are permanently deleted 30 days after your final recap is delivered — once the curated gallery and video are ready, we don't need the originals anymore.</p>
          <p><strong style={{ color: HEADING }}>Your delivered gallery and video</strong> stay accessible based on your tier: Free's gallery is downloadable for 7 days after delivery, then permanently deleted; Classic for 2 months; Signature for 4 months; Luxe for 6 months.</p>
          <p><strong style={{ color: HEADING }}>Custom package inquiries</strong> don't create a stored booking record at all — the details you submit are sent directly to us by email to follow up with you.</p>
        </Section>

        <Section title="Cookies">
          <p>We don't use tracking or advertising cookies anywhere on this site. The only cookie we set is an internal login session for staff accessing the booking dashboard — it isn't set for hosts or guests.</p>
        </Section>

        <Section title="Cancellations">
          <p>If you cancel a booking more than 24 hours before your event, any payment is refunded automatically through Stripe. Cancelling within 24 hours isn't eligible for a refund, since guest uploads may already be underway.</p>
        </Section>

        <Section title="Questions">
          <p>Reach us at <a href="mailto:hello@recappedforyou.com" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>hello@recappedforyou.com</a> or on WhatsApp (text only) at <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>+1 (646) 512-9151</a> if you have questions about your data, or want us to delete something before its normal retention period ends.</p>
        </Section>
      </div>
    </main>
  );
}
