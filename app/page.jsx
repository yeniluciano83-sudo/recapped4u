"use client";
import React, { useState, useRef } from "react";
import { Camera, Sparkles, Users, Check, ChevronRight, Play, HelpCircle, Mail, Star, Flame } from "lucide-react";

const NAV_ITEMS = [
  { id: "how", label: "How It Works" },
  { id: "services", label: "Pricing" },
  { id: "demo", label: "Demo" },
  { id: "events", label: "Event Types" },
  { id: "faq", label: "FAQ" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

const TIERS = [
  { id: "standard", name: "Standard", price: "$275", tagline: "One video, one style",
    features: ["AI-curated photo gallery", "One recap video (5-10 min)", "One editing style", "Digital delivery"] },
  { id: "premium", name: "Premium", price: "$425", tagline: "Two cuts, your style, your name in it", highlight: true,
    features: ["Everything in Standard", "Social cut (60-90 sec) + full cut", "Choose your editing style", "Editor's personal touch"] },
  { id: "keepsake", name: "Premium + Keepsake", price: "$550", tagline: "Something to hold, not just watch",
    features: ["Everything in Premium", "Printed photo book", "Priority 48-72hr turnaround"] },
];

const EVENT_TYPES = ["Parties", "Birthdays", "Corporate Events", "Family Reunions", "Housewarmings", "Retirement Parties", "Baby Showers", "Graduations", "Anniversaries", "Bachelor/Bachelorette Parties", "Vacations","Holiday Celebrations","Something Else? Ask Us"];

const FAQS = [
  { q: "Is this AI-generated?", a: "No — every photo and video clip is real footage from your event. AI only helps us quickly sort through hundreds of guest uploads to find the best moments. A real editor then puts the story together by hand." },
  { q: "Will our photos be shared with anyone else?", a: "No. Your photos and videos are used only to create your event's recap. We never sell, share, or use them for advertising, and raw guest uploads are automatically deleted 30 days after final delivery." },
  { q: "How long does it take?", a: "Standard turnaround is a few days; Premium + Keepsake includes priority 48-72 hour delivery." },
  { q: "What happens to our photos after delivery?", a: "Your gallery and video stay accessible for 90 days after delivery. Raw guest uploads are automatically removed 30 days after final delivery to protect your privacy." },
  { q: "Can guests upload without downloading an app?", a: "Yes — guests just scan a QR code or tap a link, no account or app required." },
  { q: "Do you cover weddings?", a: "Not currently — we focus on birthdays, corporate events, reunions, and other milestone celebrations." },
  { q: "Is there a limit on how many guests can upload?", a: "No hard limit — the QR link works for any size gathering, from a small family dinner to a large corporate event." },
  { q: "What if we need to cancel or reschedule?", a: "Reach out as soon as you know — we'll work with you to reschedule for a new date at no extra cost. Refund terms will be outlined in your service agreement." },
  { q: "How do we pay, and when?", a: "Payment is collected securely at booking through Stripe. We accept all major credit and debit cards." },
  { q: "Can we pick which photos and clips make the final cut?", a: "Our editor selects the best moments using AI-assisted curation plus a manual pass, but you can flag must-include moments and people in your booking notes." },
  { q: "Do you travel, or is this remote-only?", a: "Fully remote — there's no need for us to be physically present. Guests upload directly, and our editing happens entirely online, so we can work with events anywhere." },
  { q: "What's the Roast Reel add-on?", a: "An optional specialty add-on (available on Premium and Keepsake tiers for select event types) that layers witty, affectionate commentary over your photos. You choose the intensity, and you approve the full script before it's shared with guests." },
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState(null);
  const sectionRefs = useRef({});

  const scrollTo = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "#211F1Dee", backdropFilter: "blur(8px)", borderBottom: "1px solid #3a3733" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", flexShrink: 0 }}>Recapped For You</span>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {NAV_ITEMS.map((item) => (
              <button key={item.id} onClick={() => scrollTo(item.id)}
                style={{ background: "none", border: "none", color: "#a8a29a", fontSize: 12.5, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                {item.label}
              </button>
            ))}
          </div>
          <a href="/booking" style={{ flexShrink: 0, background: "#C97A3D", color: "#211F1D", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 8, textDecoration: "none" }}>
            Book Now
          </a>
        </div>
      </div>

      <section style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px 56px", textAlign: "center" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: 16 }}>
          Event recap videos & photo galleries
        </p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 40, lineHeight: 1.15, margin: "0 0 18px" }}>
          Your event, recapped — no photographer or videographer needed.
        </h1>
        <p style={{ fontSize: 16, color: "#a8a29a", lineHeight: 1.6, margin: "0 0 32px" }}>
          We turn the photos and videos your own guests already took into one polished recap video and gallery.
        </p>
        <a href="/booking" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#C97A3D", color: "#211F1D", fontSize: 15, fontWeight: 700, padding: "14px 26px", borderRadius: 10, textDecoration: "none" }}>
          Book Your Event <ChevronRight size={17} />
        </a>
      </section>

      <Section id="how" refs={sectionRefs} title="How It Works" icon={<Camera size={20} color="#C97A3D" />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {[
            { n: "1", t: "Book", d: "Pick your package and event date." },
            { n: "2", t: "Guests upload", d: "Share a QR code — guests add photos & video, no app needed." },
            { n: "3", t: "We edit", d: "AI sorts the best moments; a real editor builds the story." },
            { n: "4", t: "You receive it", d: "A polished video and gallery, ready to share and keep." },
          ].map((s) => (
            <div key={s.n} style={cardStyle}>
              <div style={{ color: "#C97A3D", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{s.n}</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.t}</div>
              <div style={{ fontSize: 13.5, color: "#a8a29a", lineHeight: 1.5 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 24, fontSize: 13.5, color: "#8a857d", lineHeight: 1.6, maxWidth: 560 }}>
          Nothing is AI-generated — every photo and clip is real footage from your event. AI just helps us find the best moments in hundreds of files quickly; a human editor puts it all together.
        </p>
      </Section>

      <Section id="services" refs={sectionRefs} title="Pricing" icon={<Sparkles size={20} color="#C97A3D" />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {TIERS.map((t) => (
            <div key={t.id} style={{ ...cardStyle, border: t.highlight ? "1.5px solid #C97A3D" : cardStyle.border }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</span>
                <span style={{ color: "#C97A3D", fontWeight: 700 }}>{t.price}</span>
              </div>
              <p style={{ fontSize: 13, color: "#a8a29a", margin: "0 0 12px" }}>{t.tagline}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: "#8a857d" }}>
                {t.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                    <Check size={13} color="#7A8B76" style={{ flexShrink: 0, marginTop: 2 }} /> {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="demo" refs={sectionRefs} title="See a Sample Recap" icon={<Play size={20} color="#C97A3D" />}>
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#332e28", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
            <Play size={24} color="#C97A3D" fill="#C97A3D" style={{ marginLeft: 3 }} />
          </div>
          <p style={{ fontSize: 14, color: "#a8a29a", margin: 0 }}>Sample recap coming soon — check back shortly.</p>
        </div>

        <div style={{ ...cardStyle, marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", border: "1.5px solid #C97A3D" }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Get 10 photos polished, free</p>
            <p style={{ fontSize: 13, color: "#a8a29a", margin: 0, maxWidth: 380 }}>
              Have a recent event? We'll edit 10 of your photos at no cost, in exchange for featuring them as samples on our site.
            </p>
          </div>
          <a href="/demo-request" style={{ background: "#C97A3D", color: "#211F1D", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
            Claim Free Demo
          </a>
        </div>

        <p style={{ marginTop: 16, fontSize: 13, color: "#6a655e" }}>
          Want to see real work sooner? Ask us for examples when you reach out.
        </p>
      </Section>

      <Section id="events" refs={sectionRefs} title="Events We Cover" icon={<Users size={20} color="#C97A3D" />}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {EVENT_TYPES.map((e) =>
            e.startsWith("Something Else") ? (
              <button key={e} onClick={() => scrollTo("contact")}
                style={{ background: "#332e28", border: "1px solid #C97A3D", color: "#C97A3D", borderRadius: 999, padding: "8px 16px", fontSize: 13.5, cursor: "pointer", fontWeight: 600 }}>
                {e}
              </button>
            ) : (
              <span key={e} style={{ background: "#2a2723", border: "1px solid #3a3733", borderRadius: 999, padding: "8px 16px", fontSize: 13.5 }}>{e}</span>
            )
          )}
        </div>
        <p style={{ marginTop: 18, fontSize: 13.5, color: "#8a857d" }}>We don't currently offer wedding coverage.</p>
      </Section>

      <Section id="faq" refs={sectionRefs} title="Frequently Asked Questions" icon={<HelpCircle size={20} color="#C97A3D" />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FAQS.map((f, i) => (
            <div key={i} style={{ ...cardStyle, padding: 0 }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#F7F3EC", padding: 18, fontSize: 14.5, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {f.q}
                <ChevronRight size={16} style={{ transform: openFaq === i ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0, marginLeft: 10 }} />
              </button>
              {openFaq === i && <p style={{ padding: "0 18px 18px", fontSize: 13.5, color: "#a8a29a", lineHeight: 1.6, margin: 0 }}>{f.a}</p>}
            </div>
          ))}
        </div>
      </Section>

      {/* About */}
      <Section id="about" refs={sectionRefs} title="About" icon={<Star size={20} color="#C97A3D" />}>
        <p style={{ fontSize: 14.5, color: "#a8a29a", lineHeight: 1.7, maxWidth: 600, marginBottom: 16 }}>
          Somewhere in your guests' camera rolls is the real story of your event — the candid laugh, the toast, the moment the whole room lit up. It's just scattered across forty different phones, most of it never seen twice.
        </p>
        <p style={{ fontSize: 14.5, color: "#a8a29a", lineHeight: 1.7, maxWidth: 600, marginBottom: 16 }}>
          Recapped For You gathers it, sorts through it, and hands it back as one film worth watching. AI does the heavy lifting — scanning hundreds of clips for the moments that matter — but a real editor decides what actually makes the cut. Taste isn't automatable, so we didn't try to automate it.
        </p>
        <p style={{ fontSize: 14.5, color: "#a8a29a", lineHeight: 1.7, maxWidth: 600 }}>
          No crew to coordinate, no camera in anyone's face. Just the party, remembered well.
        </p>
      </Section>
      <Section id="contact" refs={sectionRefs} title="Get In Touch" icon={<Mail size={20} color="#C97A3D" />}>
        <p style={{ fontSize: 14, color: "#a8a29a", marginBottom: 18 }}>
          Corporate events, custom packages, or just have a question — reach out.
        </p>
        <a href="mailto:hello@recappedforyou.com" style={{ display: "inline-block", background: "#C97A3D", color: "#211F1D", fontSize: 14.5, fontWeight: 700, padding: "12px 22px", borderRadius: 10, textDecoration: "none" }}>
          hello@recappedforyou.com
        </a>
        <p style={{ fontSize: 12.5, color: "#6a655e", marginTop: 16 }}>
          📱 WhatsApp inquiries coming soon.
        </p>
      </Section>

      <footer style={{ textAlign: "center", padding: "40px 20px", color: "#6a655e", fontSize: 12.5, borderTop: "1px solid #3a3733" }}>
        © {new Date().getFullYear()} Recapped For You
      </footer>
    </div>
  );
}

function Section({ id, refs, title, icon, children }) {
  return (
    <section ref={(el) => (refs.current[id] = el)} id={id} style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px", scrollMarginTop: 70 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        {icon}
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: 0 }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

const cardStyle = {
  background: "#2a2723",
  border: "1px solid #3a3733",
  borderRadius: 14,
  padding: 20,
};
