"use client";
import React, { useState, useRef } from "react";
import { Camera, Sparkles, Users, Check, ChevronRight, HelpCircle, Mail, Star, Flame, Menu, X, Calendar, QrCode, Wand2, PartyPopper, Gift, Crown, MessageCircle, Quote } from "lucide-react";

const NAV_ITEMS = [
  { id: "how", label: "How It Works" },
  { id: "services", label: "Pricing" },
  { id: "events", label: "Event Types" },
  { id: "faq", label: "FAQ" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

const TIERS = [
  { id: "free", name: "Free", price: "$0", tagline: "See it for yourself — no card required",
    features: ["Curated gallery (up to 20 photos)", "Short highlight video (60-90 sec)", "Choose your editing style", "Digital delivery", "Guests have 24hrs after the event to upload", "Add your own photos from your share page", "Close uploads early once everyone's uploaded", "Downloadable gallery for 7 days"] },
  { id: "standard", name: "Classic", price: "$35", tagline: "Everything you need, nothing extra",
    features: ["Unlimited photo uploads", "Shareable + printable QR code & link", "48-hour upload window after your event", "Every uploaded photo in your gallery", "One recap video", "Choose your editing style", "Digital delivery", "Downloadable gallery for 2 months", "Add your own photos from your share page", "Close uploads early once everyone's uploaded"] },
  { id: "premium", name: "Signature", price: "$75", tagline: "Make it unmistakably yours", highlight: true,
    features: ["Everything in Classic", "Social cut (60-90 sec) + full cut", "Choose your editing style, plus a separate theme for your social cut", "Star must-include photos for your social cut", "Roast Reel add-on eligible for any event type (+$20)", "1-week upload deadline", "Downloadable gallery for 4 months"] },
  { id: "keepsake", name: "Luxe", price: "$95", tagline: "The full treatment, built to last",
    features: ["Everything in Signature", "5 social cuts instead of 1, each from a different set of your best photos", "Choose your editing style, plus a separate theme for your social cuts", "24-hour priority turnaround (without Roast Reel)", "Complimentary Roast Reel add-on for any event type", "2-week upload deadline, extendable by 2 more days if needed", "Downloadable gallery for 6 months"] },
];

const EVENT_TYPES = [
  { label: "Parties", emoji: "🎉" },
  { label: "Birthdays", emoji: "🎂" },
  { label: "Weddings", emoji: "💍" },
  { label: "Engagement Parties", emoji: "💐" },
  { label: "Bridal Showers", emoji: "🎀" },
  { label: "Gender Reveals", emoji: "🎈" },
  { label: "Sweet 16s / Quinceañeras", emoji: "👑" },
  { label: "Corporate Events", emoji: "💼" },
  { label: "Family Reunions", emoji: "👨‍👩‍👧‍👦" },
  { label: "Class/Friend Reunions", emoji: "🤝" },
  { label: "Housewarmings", emoji: "🏡" },
  { label: "Retirement Parties", emoji: "🥂" },
  { label: "Baby Showers", emoji: "🍼" },
  { label: "Graduations", emoji: "🎓" },
  { label: "Anniversaries", emoji: "✨" },
  { label: "Bachelor/Bachelorette Parties", emoji: "🎊" },
  { label: "Religious Ceremonies", emoji: "🙏" },
  { label: "Fundraisers & Galas", emoji: "🎗️" },
  { label: "Vacations", emoji: "✈️" },
  { label: "Holiday Celebrations", emoji: "🎇" },
  { label: "Something Else? Ask Us", emoji: "💬" },
];

// Small visual identity per tier for the pricing cards -- purely
// decorative, doesn't touch the actual price/feature data above.
const TIER_ICONS = { free: Gift, standard: Camera, premium: Star, keepsake: Crown };

const FAQS = [
  { q: "Is this real footage, or generated?", a: "It's all real — every photo is genuine footage from your event. Our process analyzes and scores hundreds of guest uploads to find the best moments, then automatically cuts, grades, and paces them into your final story — nothing here is synthetic or computer-generated, and nothing waits on a human editor's schedule." },
  { q: "Will our photos be shared with anyone else?", a: "No. Your photos are used only to create your event's recap. We never sell, share, or use them for advertising, and raw guest uploads are automatically deleted 30 days after final delivery." },
  { q: "How long does it take?", a: "Standard turnaround is a few days; Luxe includes 24-hour priority delivery (without the Roast Reel add-on, since that step waits on your approval)." },
  { q: "What happens to our photos after delivery?", a: "Your gallery and video stay accessible for 2 months on Classic, 4 months on Signature, and 6 months on Luxe. Free's gallery and video are downloadable for 7 days after delivery, after which they're permanently removed. Raw guest uploads are automatically removed 30 days after final delivery to protect your privacy. Your photos and data are never sold to a third party." },
  { q: "Can guests upload without downloading an app?", a: "Yes — guests just scan a QR code or tap a link, no account or app required." },
  { q: "Is there a limit on how many guests can upload?", a: "No hard limit — the QR link works for any size gathering, from a small family dinner to a large corporate event." },
  { q: "What if we need to cancel or reschedule?", a: "Your booking confirmation email includes both a reschedule link and a cancellation link. Reschedule for free anytime up to 24 hours before your event — your guest upload link and QR code stay the same. Cancel more than 24 hours before your event for a full refund automatically; cancellations inside 24 hours aren't eligible for a refund since guest uploads may already be underway. Either one inside that 24-hour window just needs a reply to your confirmation email instead." },
  { q: "How do we pay?", a: "Payment is collected securely at booking through Stripe. We accept all major credit and debit cards." },
  { q: "Can we pick which photos make the final cut?", a: "Our automated curation selects the best moments for your main video, but your photo gallery includes every photo your guests upload, not just the ones that made the video. On Signature and Luxe, you can also star must-include photos for your social cut from your QR share page." },
  { q: "What editing styles can I choose from?", a: "Cinematic (slow, emotional, warm color grade), Upbeat (fast cuts, high energy, beat-synced), Documentary (minimal, candid, true to the moment), Nostalgic / Retro (warm film grain, vintage titles, scrapbook feel), and Highlight Reel (bold text call-outs, punchy sports-style energy). On Signature and Luxe, you can also pick a separate style just for your social cut." },
  { q: "What's the Roast Reel add-on?", a: "An optional specialty add-on (available on Signature and Luxe tiers) that layers witty, affectionate commentary over your photos. You choose the intensity, and you approve the full script before it's shared with guests. Available for any event type." },
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const sectionRefs = useRef({});

  const scrollTo = (id) => {
    setMobileMenuOpen(false);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "#FAF7F2ee", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", borderBottom: "1px solid #E4DED2" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", flexShrink: 0 }}>
            <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #C97A3D, #E0985A)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Camera size={14} color="#FFFFFF" />
            </span>
            Recapped For You
          </span>
          <div className="nav-links" style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {NAV_ITEMS.map((item) => (
              <button key={item.id} onClick={() => scrollTo(item.id)}
                style={{ background: "none", border: "none", color: "#4a4642", fontSize: 12.5, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                {item.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <a href="/booking" style={{ backgroundImage: "linear-gradient(135deg, #C97A3D, #E0985A)", color: "#211F1D", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 8, textDecoration: "none" }}>
              Book Now
            </a>
            <button className="nav-hamburger" onClick={() => setMobileMenuOpen((o) => !o)}
              style={{ display: "none", background: "none", border: "1px solid #E4DED2", borderRadius: 8, padding: 8, cursor: "pointer", color: "#211F1D" }}
              aria-label="Toggle menu">
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="nav-mobile-panel" style={{ borderTop: "1px solid #E4DED2", background: "#FAF7F2", padding: "8px 20px 14px", display: "flex", flexDirection: "column" }}>
            {NAV_ITEMS.map((item) => (
              <button key={item.id} onClick={() => scrollTo(item.id)}
                style={{ background: "none", border: "none", color: "#4a4642", fontSize: 14, padding: "10px 0", cursor: "pointer", textAlign: "left" }}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @media (max-width: 850px) {
          .nav-links { display: none !important; }
          .nav-hamburger { display: flex !important; align-items: center; justify-content: center; }
        }
        .nav-mobile-panel { display: none; }
        @media (max-width: 850px) {
          .nav-mobile-panel { display: flex !important; }
        }

        .how-timeline { display: flex; flex-direction: column; }
        .how-step { display: flex; gap: 16px; }
        .how-step-node { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
        .how-step-circle {
          width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #C97A3D, #E0985A);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(201,122,61,0.32);
        }
        .how-step-line { width: 2px; flex: 1; min-height: 28px; background: #E4DED2; margin: 6px 0; }
        .how-step-content { padding-bottom: 28px; }
        .how-step-title { font-family: Georgia, serif; font-size: 17px; font-weight: 700; margin: 6px 0 5px; }
        .how-step-desc { font-size: 13.5px; color: #4a4642; line-height: 1.55; max-width: 480px; }
        @media (min-width: 760px) {
          .how-timeline { flex-direction: row; align-items: flex-start; }
          .how-step { flex-direction: column; align-items: stretch; flex: 1; gap: 0; }
          .how-step-node { flex-direction: row; width: 100%; }
          .how-step-line { height: 2px; width: auto; flex: 1; min-height: 0; margin: 0 8px; align-self: center; }
          .how-step-content { padding-bottom: 0; padding-right: 12px; }
          .how-step-title { margin-top: 14px; }
        }

        .sprocket-divider {
          height: 10px;
          background-image: radial-gradient(circle, #D8CFC0 2px, transparent 2.5px);
          background-size: 20px 10px;
          background-repeat: repeat-x;
          background-position: center;
          opacity: 0.7;
        }

        .price-card { transition: transform 0.25s ease, box-shadow 0.25s ease; }
        .price-card:hover { transform: translateY(-4px) rotate(0deg) !important; box-shadow: 0 14px 30px rgba(33,31,29,0.1); }

        .contact-row { display: flex; flex-direction: column; gap: 12px; }
        @media (min-width: 560px) {
          .contact-row { flex-direction: row; }
        }

        .event-scene { position: relative; width: 350px; height: 508px; margin: 40px auto 0; }
        .event-stage {
          position: absolute; top: 0; width: 110px; height: 160px; border-radius: 16px;
          background-size: cover; background-position: center 30%; background-color: #E4DED2;
          box-shadow: inset 0 0 0 1px rgba(33,31,29,0.06); overflow: hidden;
        }
        .event-badge {
          position: absolute; left: 6px; top: 6px; width: 24px; height: 24px; border-radius: 50%;
          background: #FFFFFF; box-shadow: 0 2px 6px rgba(33,31,29,0.15);
          display: flex; align-items: center; justify-content: center; font-size: 13px; z-index: 1;
        }
        .event-flash { position: absolute; inset: 0; background: #FFFFFF; opacity: 0; }
        .event-flash-1 { animation: eventFlash1 10s ease-in-out infinite; }
        .event-flash-2 { animation: eventFlash2 10s ease-in-out infinite; }
        .event-flash-3 { animation: eventFlash3 10s ease-in-out infinite; }

        /* A high-tech landing zone for the photos to fall into -- a stylized
           monitor (bezel + glowing screen + stand) rather than a plain
           frame, so it feels like real hardware rather than an abstract
           filmstrip outline. */
        .event-monitor-bezel {
          position: absolute; left: 0; top: 176px; width: 350px; height: 120px; border-radius: 14px;
          background: linear-gradient(160deg, #3A362F, #1A1815); box-shadow: 0 10px 24px rgba(33,31,29,0.28);
        }
        .event-monitor-screen {
          position: absolute; left: 10px; top: 10px; right: 10px; bottom: 10px; border-radius: 6px;
          background: linear-gradient(160deg, #1C2128, #10131A);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 0 26px rgba(74,158,168,0.16);
          overflow: hidden;
        }
        .event-monitor-scanlines {
          position: absolute; inset: 0; pointer-events: none;
          background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px);
        }
        .event-monitor-led { position: absolute; right: 14px; bottom: 7px; width: 5px; height: 5px; border-radius: 50%; background: #4A9EA8; animation: eventLedPulse 2.4s ease-in-out infinite; }
        .event-monitor-neck { position: absolute; left: 167px; top: 296px; width: 16px; height: 18px; background: linear-gradient(160deg, #3A362F, #211F1D); }
        .event-monitor-base { position: absolute; left: 130px; top: 314px; width: 90px; height: 8px; border-radius: 4px; background: linear-gradient(160deg, #3A362F, #211F1D); }

        /* Each person drops two photos into the monitor over the course of
           the loop, not just one -- same three source photos reused for
           the second landing, since sourcing more images is unnecessary
           here, but it reads as the guest taking several shots and fills
           the screen with more than three lonely polaroids. Base position
           below is the FIRST landing spot; each eventFlyN keyframe animates
           a translateY down to the second spot for its second half,
           instead of adding more DOM elements. */
        .event-polaroid {
          position: absolute; top: 194px; width: 28px; height: 34px; border-radius: 3px;
          background: #FFFFFF; box-shadow: 0 4px 10px rgba(0,0,0,0.4);
          padding: 2px 2px 6px; box-sizing: border-box; z-index: 1;
        }
        .event-polaroid-photo { width: 100%; height: 100%; border-radius: 1px; background-size: cover; background-position: center 25%; }
        .event-polaroid-1 { left: 41px; animation: eventFly1 10s ease-in-out infinite; }
        .event-polaroid-2 { left: 161px; animation: eventFly2 10s ease-in-out infinite; }
        .event-polaroid-3 { left: 281px; animation: eventFly3 10s ease-in-out infinite; }

        /* The video slideshow the monitor feeds into -- a real-sized player
           below the stand (not a sliver) that cross-fades through the same
           three photos with a scrubbing progress bar so it reads as
           playing rather than just another static frame. */
        .event-video { position: absolute; left: 20px; top: 338px; width: 310px; height: 170px; border-radius: 14px; border: 2px solid #C97A3D; background: #211F1D; overflow: hidden; }
        .event-video-slide { position: absolute; inset: 0; background-size: cover; background-position: center 22%; opacity: 0; }
        .event-video-slide-1 { animation: eventSlide1 10s ease-in-out infinite; }
        .event-video-slide-2 { animation: eventSlide2 10s ease-in-out infinite; }
        .event-video-slide-3 { animation: eventSlide3 10s ease-in-out infinite; }
        .event-video-play {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.85);
          color: #211F1D; font-size: 15px; display: flex; align-items: center; justify-content: center; padding-left: 2.5px;
        }
        .event-video-progress { position: absolute; left: 0; bottom: 0; height: 4px; background: #C97A3D; width: 0%; animation: eventProgress 10s ease-in-out infinite; }

        /* Two flash pulses per phone now, one for each of that persons two
           photos -- timed just before the matching eventFlyN pop-out moment. */
        @keyframes eventFlash1 {
          0%, 3% { opacity: 0; }
          5% { opacity: 0.85; }
          8%, 39% { opacity: 0; }
          41% { opacity: 0.85; }
          44%, 100% { opacity: 0; }
        }
        @keyframes eventFlash2 {
          0%, 16% { opacity: 0; }
          18% { opacity: 0.85; }
          21%, 52% { opacity: 0; }
          55% { opacity: 0.85; }
          58%, 100% { opacity: 0; }
        }
        @keyframes eventFlash3 {
          0%, 28% { opacity: 0; }
          30% { opacity: 0.85; }
          33%, 60% { opacity: 0; }
          62% { opacity: 0.85; }
          65%, 100% { opacity: 0; }
        }
        @keyframes eventLedPulse {
          0%, 100% { opacity: 0.5; } 50% { opacity: 1; }
        }
        @keyframes eventFly1 {
          0%, 3% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          7% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          20% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          36% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          40% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          44% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          56% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(5deg); }
          84% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(5deg); }
          92%, 100% { opacity: 0; transform: translate(0, 50px) scale(1) rotate(5deg); }
        }
        @keyframes eventFly2 {
          0%, 16% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          20% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          33% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          49% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          53% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          57% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          69% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(-5deg); }
          90% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(-5deg); }
          97%, 100% { opacity: 0; transform: translate(0, 50px) scale(1) rotate(-5deg); }
        }
        @keyframes eventFly3 {
          0%, 28% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          32% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          44% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          56% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          60% { opacity: 0; transform: translate(0, -112px) scale(0.35) rotate(0deg); }
          64% { opacity: 1; transform: translate(0, -112px) scale(0.5) rotate(0deg); }
          76% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(4deg); }
          92% { opacity: 1; transform: translate(0, 50px) scale(1) rotate(4deg); }
          97%, 100% { opacity: 0; transform: translate(0, 50px) scale(1) rotate(4deg); }
        }
        @keyframes eventSlide1 {
          0%, 3% { opacity: 0; } 6%, 28% { opacity: 1; } 31%, 100% { opacity: 0; }
        }
        @keyframes eventSlide2 {
          0%, 31% { opacity: 0; } 34%, 56% { opacity: 1; } 59%, 100% { opacity: 0; }
        }
        @keyframes eventSlide3 {
          0%, 59% { opacity: 0; } 62%, 84% { opacity: 1; } 87%, 100% { opacity: 0; }
        }
        @keyframes eventProgress {
          0% { width: 0%; } 97% { width: 100%; } 100% { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .event-flash, .event-polaroid, .event-video-slide, .event-video-progress, .event-monitor-led { animation: none !important; }
          .event-flash { opacity: 0; }
          .event-polaroid { opacity: 1; transform: translate(0,50px) scale(1) rotate(-4deg); }
          .event-video-slide-1 { opacity: 1; }
          .event-video-progress { width: 45%; }
          .event-monitor-led { opacity: 1; }
        }
        @media (max-width: 380px) {
          .event-scene { transform: scale(0.86); transform-origin: top center; }
        }

      `}</style>

      <main>
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px 56px", textAlign: "center", position: "relative", backgroundImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #FBEEE0, transparent)" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: 16 }}>
          Event recap videos & photo galleries
        </p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 40, lineHeight: 1.15, margin: "0 0 18px" }}>
          Your event, recapped — no photographer needed.
        </h1>
        <p style={{ fontSize: 16, color: "#4a4642", lineHeight: 1.6, margin: "0 0 32px" }}>
          We turn the photos your own guests already took into one polished recap video and gallery.
        </p>
        <a href="/booking" style={{ display: "inline-flex", alignItems: "center", gap: 8, backgroundImage: "linear-gradient(135deg, #C97A3D, #E0985A)", color: "#211F1D", fontSize: 15, fontWeight: 700, padding: "14px 26px", borderRadius: 10, textDecoration: "none", boxShadow: "0 8px 22px rgba(201,122,61,0.28)" }}>
          Book Your Event <ChevronRight size={17} />
        </a>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 28 }}>
          {[
            { icon: Check, label: "Real footage, never generated" },
            { icon: QrCode, label: "No app for guests" },
            { icon: Mail, label: "Delivered straight to your inbox" },
          ].map((p) => (
            <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #E4DED2", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, color: "#4a4642", fontWeight: 500 }}>
              <p.icon size={13} color="#7A8B76" /> {p.label}
            </span>
          ))}
        </div>

        <EventPhotoScene />
      </section>

      <Section id="how" refs={sectionRefs} title="How It Works" icon={<Camera size={20} color="#C97A3D" />}
        subtitle="From your guests' camera rolls to your inbox — four steps, zero editing skills required.">
        <div className="how-timeline">
          {[
            { n: "1", icon: Calendar, t: "Book", d: "Pick your package and event date — takes less than 2 minutes." },
            { n: "2", icon: QrCode, t: "Everyone pitches in", d: "Share your QR code digitally or print it on cards. Guests add photos with zero apps and zero fuss, and you can toss in your own from the same page." },
            { n: "3", icon: Wand2, t: "We do the editing", d: "Once uploads close, every photo is scored for focus, light, and energy, then cut, graded, and paced into your story — automatically, start to finish." },
            { n: "4", icon: PartyPopper, t: "It lands in your inbox", d: "A polished video and gallery, ready to relive, share, and keep." },
          ].map((s, i, arr) => {
            const Icon = s.icon;
            return (
              <div className="how-step" key={s.n}>
                <div className="how-step-node">
                  <div className="how-step-circle"><Icon size={19} color="#FFFFFF" strokeWidth={2} /></div>
                  {i < arr.length - 1 && <div className="how-step-line" />}
                </div>
                <div className="how-step-content">
                  <div className="how-step-title">{s.t}</div>
                  <div className="how-step-desc">{s.d}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, display: "inline-flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: "#6b655c", lineHeight: 1.6, maxWidth: 560, background: "#FBEEE0", border: "1px solid #E4DED2", borderRadius: 10, padding: "12px 14px" }}>
          <Check size={15} color="#7A8B76" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Nothing here is synthetic or computer-generated — every photo is real footage from your event. Our process finds the best moments in hundreds of files, then automatically cuts, grades, and paces them into your story.</span>
        </div>
      </Section>

      <Section id="services" refs={sectionRefs} title="Pricing" icon={<Sparkles size={20} color="#C97A3D" />} band="white"
        subtitle="Start for free, or pick the tier that matches how much of the night you want captured.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 20, padding: "6px 4px" }}>
          {TIERS.map((t, idx) => {
            const TierIcon = TIER_ICONS[t.id] || Sparkles;
            const tilt = [-1.3, 0.9, 0, -0.7][idx] || 0;
            return (
            <div key={t.id} className="price-card" style={{
              ...cardStyle, position: "relative",
              border: t.highlight ? "1.5px solid #C97A3D" : cardStyle.border,
              boxShadow: t.highlight ? "0 10px 26px rgba(201,122,61,0.22)" : "0 3px 10px rgba(33,31,29,0.05)",
              transform: t.highlight ? "scale(1.03)" : `rotate(${tilt}deg)`,
            }}>
              {t.highlight ? (
                <span style={{ position: "absolute", top: -11, left: 16, background: "#C97A3D", color: "#211F1D", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 999 }}>
                  Most popular
                </span>
              ) : (
                <div aria-hidden="true" style={{ position: "absolute", top: -9, left: "50%", transform: `translateX(-50%) rotate(${-tilt * 2}deg)`, width: 50, height: 16, background: "rgba(122,139,118,0.32)", borderRadius: 2 }} />
              )}
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "#FBEEE0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <TierIcon size={16} color="#C97A3D" />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</span>
                <span style={{ color: "#C97A3D", fontWeight: 700 }}>{t.price}</span>
              </div>
              <p style={{ fontSize: 13, color: "#4a4642", margin: "0 0 12px" }}>{t.tagline}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: "#6b655c" }}>
                {t.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                    <Check size={13} color="#7A8B76" style={{ flexShrink: 0, marginTop: 2 }} /> {f}
                  </li>
                ))}
              </ul>
            </div>
            );
          })}
        </div>
        <div style={{ ...cardStyle, marginTop: 16, border: "1.5px solid #C97A3D" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #C97A3D, #E0985A)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(201,122,61,0.32)" }}>
              <Flame size={16} color="#FFFFFF" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15.5 }}>Roast Reel</span>
            <span style={{ fontSize: 11.5, color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Specialty add-on</span>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>Your recap, but make it savage. Affectionately.</p>
          <p style={{ fontSize: 13, color: "#4a4642", margin: "0 0 14px", maxWidth: 520 }}>
            Witty, affectionate commentary layered over your photos — you pick how far to take it, and you approve the full script before anyone sees it. Available on Signature and Luxe for any event type.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Light Roasting", desc: "Playful, gentle teasing" },
              { label: "Lukewarm Roasting", desc: "Sharper, inside-joke energy" },
              { label: "Hot Roasting", desc: "Full send, close friends only" },
            ].map((r) => (
              <div key={r.label} style={{ background: "#FAF7F2", border: "1px solid #E4DED2", borderRadius: 10, padding: "10px 14px", flex: "1 1 150px" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: "#6b655c", marginTop: 2 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="events" refs={sectionRefs} title="Events We Cover" icon={<Users size={20} color="#C97A3D" />} band="white"
        subtitle="If people are gathered and phones are out, we've probably got it covered.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {EVENT_TYPES.map((e) =>
            e.label.startsWith("Something Else") ? (
              <button key={e.label} onClick={() => scrollTo("contact")}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#FBEEE0", border: "1px solid #C97A3D", color: "#C97A3D", borderRadius: 999, padding: "8px 16px", fontSize: 13.5, cursor: "pointer", fontWeight: 600, maxWidth: "100%" }}>
                <span aria-hidden="true">{e.emoji}</span> {e.label}
              </button>
            ) : (
              <span key={e.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#FAF7F2", border: "1px solid #E4DED2", borderRadius: 999, padding: "8px 16px", fontSize: 13.5, maxWidth: "100%" }}>
                <span aria-hidden="true">{e.emoji}</span> {e.label}
              </span>
            )
          )}
        </div>
      </Section>

      <Section id="faq" refs={sectionRefs} title="Frequently Asked Questions" icon={<HelpCircle size={20} color="#C97A3D" />}
        subtitle="Everything we get asked before someone books — answered upfront.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FAQS.map((f, i) => {
            const isOpen = openFaq === i;
            return (
            <div key={i} style={{ ...cardStyle, padding: 0, borderLeft: isOpen ? "3px solid #C97A3D" : "1px solid #E4DED2", background: isOpen ? "#FFFDF9" : cardStyle.background, transition: "border-color 0.2s, background 0.2s" }}>
              <button onClick={() => setOpenFaq(isOpen ? null : i)} aria-expanded={isOpen}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#211F1D", padding: 18, fontSize: 14.5, fontWeight: 600, cursor: "pointer", display: "flex", gap: 14, alignItems: "center" }}>
                <span style={{ fontFamily: "Georgia, serif", fontSize: 13, color: isOpen ? "#C97A3D" : "#C9BFA9", flexShrink: 0, minWidth: 22 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ flex: 1 }}>{f.q}</span>
                <ChevronRight size={16} color={isOpen ? "#C97A3D" : "#211F1D"} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
              </button>
              {isOpen && <p style={{ padding: "0 18px 18px 54px", fontSize: 13.5, color: "#4a4642", lineHeight: 1.6, margin: 0 }}>{f.a}</p>}
            </div>
            );
          })}
        </div>
      </Section>

      {/* About */}
      <Section id="about" refs={sectionRefs} title="About" icon={<Star size={20} color="#C97A3D" />} band="tint">
        <div style={{ position: "relative", maxWidth: 620, paddingLeft: 24, borderLeft: "3px solid #C97A3D" }}>
          <Quote aria-hidden="true" size={72} color="#C97A3D" style={{ position: "absolute", top: -18, left: -8, opacity: 0.12, transform: "scaleX(-1)" }} />
          <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 19, color: "#211F1D", lineHeight: 1.55, marginBottom: 18, position: "relative" }}>
            Somewhere across your guests' phones is the real story of your event — the candid laugh, the toast, the moment the whole room lit up at once.
          </p>
          <p style={{ fontSize: 14.5, color: "#4a4642", lineHeight: 1.7, marginBottom: 16 }}>
            It's just scattered across many different camera rolls, most of it destined to be seen once and forgotten. Recapped For You gathers it, sorts through it, and hands it back as a film worth watching and a photo gallery worth keeping — no stranger holding a camera all night. Every photo is scored the moment it lands, for focus, light, and the split-second energy that makes a moment worth keeping, then cut, graded, and paced automatically.
          </p>
          <p style={{ fontSize: 14.5, color: "#4a4642", lineHeight: 1.7 }}>
            Taste isn't a mood or a deadline here — it's built into the process, so the story you get back is exactly as good on a Tuesday as it is on a Saturday.
          </p>
        </div>
      </Section>
      <Section id="contact" refs={sectionRefs} title="Get In Touch" icon={<Mail size={20} color="#C97A3D" />} band="white"
        subtitle="Corporate events, custom packages, or just have a question — reach out.">
        <div className="contact-row">
          <a href="mailto:hello@recappedforyou.com" style={{ ...cardStyle, flex: 1, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #C97A3D, #E0985A)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(201,122,61,0.32)" }}>
              <Mail size={18} color="#FFFFFF" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Email</div>
              <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>hello@recappedforyou.com</div>
            </div>
          </a>
          <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ ...cardStyle, flex: 1, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #7A8B76, #97A893)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(122,139,118,0.32)" }}>
              <MessageCircle size={18} color="#FFFFFF" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>WhatsApp (text only)</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>+1 (646) 512-9151</div>
            </div>
          </a>
        </div>
      </Section>
      </main>

      <footer style={{ textAlign: "center", padding: "40px 20px", color: "#8a857d", fontSize: 12.5, borderTop: "1px solid #E4DED2" }}>
        © {new Date().getFullYear()} Recapped For You LLC · <a href="/privacy" style={{ color: "#8a857d", textDecoration: "underline" }}>Privacy Policy</a> · <a href="/terms" style={{ color: "#8a857d", textDecoration: "underline" }}>Terms of Service</a>
      </footer>
    </div>
  );
}

// Illustrates the actual thing this product does: guests at different kinds
// of events snap phone photos, and those photos become the polaroid-style
// clips that get cut into one video. These stills are AI-generated stock-style
// portraits (not real customer photos, not real people) -- picked deliberately
// generic/anonymous rather than anything that could be mistaken for actual
// event footage, since real, unedited guest uploads are what the product
// itself delivers (see the "Real footage, never generated" badge above).
const EVENT_SCENES = [
  { id: 1, x: 0, emoji: "💍", label: "Wedding", photo: "/images/hero-wedding.jpg" },
  { id: 2, x: 120, emoji: "🎂", label: "Birthday", photo: "/images/hero-birthday.jpg" },
  { id: 3, x: 240, emoji: "🎉", label: "Party", photo: "/images/hero-party.jpg" },
];

function EventPhotoScene() {
  return (
    <div className="event-scene" role="img" aria-label="Animated illustration of guests at a wedding, a birthday, and a party each taking a phone photo that falls into a monitor screen as a polaroid, then plays as a video slideshow below it">
      {EVENT_SCENES.map((s) => (
        <div key={s.id} className="event-stage" style={{ left: s.x, backgroundImage: `url(${s.photo})` }}>
          <span className="event-badge" aria-hidden="true">{s.emoji}</span>
          <div className={`event-flash event-flash-${s.id}`} />
        </div>
      ))}

      <div className="event-monitor-bezel" aria-hidden="true">
        <div className="event-monitor-screen">
          <div className="event-monitor-scanlines" />
        </div>
        <div className="event-monitor-led" />
      </div>
      <div className="event-monitor-neck" aria-hidden="true" />
      <div className="event-monitor-base" aria-hidden="true" />

      {EVENT_SCENES.map((s) => (
        <div key={`polaroid-${s.id}`} className={`event-polaroid event-polaroid-${s.id}`}>
          <div className="event-polaroid-photo" style={{ backgroundImage: `url(${s.photo})` }} />
        </div>
      ))}

      <div className="event-video" aria-hidden="true">
        {EVENT_SCENES.map((s) => (
          <div key={`slide-${s.id}`} className={`event-video-slide event-video-slide-${s.id}`} style={{ backgroundImage: `url(${s.photo})` }} />
        ))}
        <span className="event-video-play">▶</span>
        <div className="event-video-progress" />
      </div>
    </div>
  );
}

const BAND_COLORS = { white: "#FFFFFF", tint: "#FBEEE0" };

function Section({ id, refs, title, icon, children, subtitle, band }) {
  const content = (
    <section ref={(el) => (refs.current[id] = el)} id={id} style={{ maxWidth: 900, margin: "0 auto", padding: "56px 24px", scrollMarginTop: 70 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subtitle ? 10 : 24 }}>
        {icon}
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: 0 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 15, color: "#6b655c", margin: "0 0 28px", maxWidth: 520, lineHeight: 1.5 }}>{subtitle}</p>}
      {children}
    </section>
  );

  if (!band) return content;

  return (
    <div style={{ background: BAND_COLORS[band] }}>
      <div className="sprocket-divider" />
      {content}
      <div className="sprocket-divider" />
    </div>
  );
}

const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E4DED2",
  borderRadius: 14,
  padding: 20,
};
