export const metadata = {
  title: "Terms of Service — Recapped For You",
  description: "The terms that apply to booking, guest uploads, and using Recapped For You.",
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

export default function TermsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: HEADING, fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "56px 20px 80px" }}>
        <a href="/" style={{ fontSize: 12.5, color: ACCENT, fontWeight: 600, textDecoration: "none" }}>← Back to Recapped For You</a>

        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "24px 0 8px" }}>Terms of Service</p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 32, margin: "0 0 8px", lineHeight: 1.15 }}>The fine print</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px" }}>Last updated August 2026</p>

        <div style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px", marginBottom: 36 }}>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.6 }}>
            This is a plain-language summary of what applies when you book, or when a guest uploads to, an event through Recapped For You. It isn't a substitute for legal advice — treat it as a starting point, not a finished legal document.
          </p>
        </div>

        <Section title="What we provide">
          <p>Recapped For You turns photos and videos your event's guests upload into an edited recap video and curated photo gallery. Turnaround times we quote (a few days on Classic/Signature, 24 hours on Luxe without a Roast Reel) are estimates, not guarantees — delivery can take longer if guest uploads arrive late or in unusually large volume.</p>
        </Section>

        <Section title="Guest-uploaded content">
          <p>By uploading a photo or video, a guest confirms they have the right to share it — meaning they either took it themselves or have permission from whoever did, and they're comfortable with the host and other event guests seeing it in the final recap.</p>
          <p>Uploaded content is used only to build that event's recap video and gallery. The host who booked the event is the one who receives and controls access to the finished result — Recapped For You doesn't publish, sell, or reuse guest content anywhere else.</p>
          <p>Raw uploads are deleted 30 days after final delivery, as described in our <a href="/privacy" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>Privacy Policy</a>.</p>
        </Section>

        <Section title="Payment and cancellation">
          <p>Payment is collected at booking through Stripe. Cancelling more than 24 hours before your event gets you a full automatic refund; cancelling within 24 hours isn't eligible for a refund, since guest uploads may already be underway by then. Custom packages are priced and paid for separately, outside this flow, once scope is agreed on directly with us.</p>
        </Section>

        <Section title="Acceptable use">
          <p>Don't upload content that's illegal, infringes someone else's rights, or that you don't have permission to share. We can remove content or decline to process a booking that violates this.</p>
        </Section>

        <Section title="No guarantee of outcome">
          <p>Our automated process selects and edits from whatever footage guests actually upload — we can't guarantee a specific number of usable photos or clips, since that depends entirely on what guests submit. If very little gets uploaded, the recap will reflect that.</p>
        </Section>

        <Section title="Limitation of liability">
          <p>We're not liable for content guests choose to upload, for delays caused by late or missing guest uploads, or for indirect damages arising from use of the service. Our liability for any issue is limited to the amount you paid for the booking in question.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>We may update these terms as the product changes. Continuing to use Recapped For You after an update means you accept the current version.</p>
        </Section>

        <Section title="Questions">
          <p>Reach us at <a href="mailto:hello@recappedforyou.com" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>hello@recappedforyou.com</a> or on WhatsApp at <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>+1 (646) 512-9151</a>.</p>
        </Section>
      </div>
    </main>
  );
}
