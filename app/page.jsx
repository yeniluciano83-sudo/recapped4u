"use client";
import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
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
    features: ["Curated gallery (up to 20 photos)", "Short highlight video (60-90 sec)", "Choose your editing style", "Digital delivery", "24-hour upload window after your event", "Add your own photos from your share page", "Close uploads early once everyone's uploaded", "Downloadable gallery for 7 days"] },
  { id: "standard", name: "Classic", price: "$35", tagline: "Everything you need, nothing extra",
    features: ["Unlimited photo uploads", "Shareable + printable QR code & link", "48-hour upload window after your event", "Every uploaded photo in your gallery", "One recap video", "Choose your editing style", "Digital delivery", "Downloadable gallery for 2 months", "Add your own photos from your share page", "Close uploads early once everyone's uploaded"] },
  { id: "premium", name: "Signature", price: "$75", tagline: "Make it unmistakably yours", highlight: true,
    features: ["Everything in Classic", "Social cut (60-90 sec) + full cut, or swap to social-cuts-only at booking", "Choose your editing style, plus a separate theme for your social cut", "Star must-include photos for your social cut", "Roast Reel add-on eligible for any event type (+$20)", "1-week upload deadline", "Downloadable gallery for 4 months"] },
  { id: "keepsake", name: "Luxe", price: "$95", tagline: "The full treatment, built to last",
    features: ["Everything in Signature", "5 social cuts instead of 1, each from a different set of your best photos", "Choose your editing style, plus a separate theme for your social cuts", "24-hour priority turnaround", "Complimentary Roast Reel add-on for any event type", "2-week upload deadline, extendable by 2 more days if needed", "Downloadable gallery for 6 months"] },
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
  { q: "How long does it take?", a: "Standard turnaround is a few days; Luxe includes 24-hour priority delivery, Roast Reel included." },
  { q: "What happens to our photos after delivery?", a: "Your gallery and video stay accessible for 2 months on Classic, 4 months on Signature, and 6 months on Luxe. Free's gallery and video are downloadable for 7 days after delivery, after which they're permanently removed. Raw guest uploads are automatically removed 30 days after final delivery to protect your privacy. Your photos and data are never sold to a third party." },
  { q: "Can guests upload without downloading an app?", a: "Yes — guests just scan a QR code or tap a link, no account or app required." },
  { q: "Is there a limit on how many guests can upload?", a: "No hard limit on who can upload — the QR link works for any size gathering, from a small family dinner to a large corporate event. Free's curated gallery only keeps the top 20 photos, though; every paid tier includes every photo your guests upload." },
  { q: "What if we need to cancel or reschedule?", a: "Your booking confirmation email includes both a reschedule link and a cancellation link. Reschedule for free anytime up to 24 hours before your event — your guest upload link and QR code stay the same. Cancel more than 24 hours before your event for a full refund automatically; cancellations inside 24 hours aren't eligible for a refund since guest uploads may already be underway. Either one inside that 24-hour window just needs a reply to your confirmation email instead." },
  { q: "How do we pay?", a: "Payment is collected securely at booking through Stripe. We accept all major credit and debit cards." },
  { q: "Can we pick which photos make the final cut?", a: "Our automated curation selects the best moments for your main video, but your photo gallery includes every photo your guests upload, not just the ones that made the video. On Signature and Luxe, you can also star must-include photos for your social cut from your QR share page." },
  { q: "What editing styles can I choose from?", a: "Cinematic (slow, emotional, warm color grade), Upbeat (fast cuts, high energy, beat-synced), Documentary (minimal, candid, true to the moment), Nostalgic / Retro (warm film grain, vintage titles, scrapbook feel), and Highlight Reel (bold text call-outs, punchy sports-style energy). On Signature and Luxe, you can also pick a separate style just for your social cut." },
  { q: "What's a social cut?", a: "A short, 60–90 second vertical edit sized for Instagram, TikTok, or Reels. Signature gives you 1 social cut plus your full recap video. Luxe gives you 5 social cuts, each from a different set of your best photos, plus your full recap video. Both tiers also let you swap to a social-cuts-only delivery at booking — no full video, just social cuts, made from every single photo your guests upload. That swap is the only case where every uploaded photo is guaranteed to appear somewhere in your video; the default social cut(s) are still curated down to your best moments, same as the full video. Either way, you can give your social cut its own editing style, separate from your main video, and star must-include photos for it from your QR share page." },
  { q: "What's the Roast Reel add-on?", a: "An optional specialty add-on (available on Signature and Luxe tiers) that layers witty, affectionate commentary over your photos. You choose the intensity, and every joke sticks to roasting the moment, never a person's appearance — so you get both a captioned cut and a caption-free version of the same video, ready to go. Available for any event type." },
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
            <a href="/booking" className="press-btn" style={{ backgroundImage: "linear-gradient(135deg, #C97A3D, #E0985A)", color: "#211F1D", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 8, textDecoration: "none", display: "inline-block" }}>
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
        .how-step { display: flex; gap: 20px; }
        .how-step-node { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
        .how-step-circle {
          width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #C97A3D, #E0985A);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(201,122,61,0.32);
        }
        .how-step-line { width: 2px; flex: 1; min-height: 0; background: #E4DED2; margin: 6px 0; }
        .how-step-content { padding-bottom: 28px; }
        .how-step-title { font-family: Georgia, serif; font-size: 17px; font-weight: 700; margin: 12px 0 5px; }
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

        /* Shared tactile press feedback for primary buttons/links -- a
           quick scale-down on click, not just a hover state, so clicking
           actually feels like pressing something. */
        .press-btn { transition: transform 0.15s ease; }
        .press-btn:active { transform: scale(0.96); }
        @media (prefers-reduced-motion: reduce) {
          .press-btn:active { transform: none; }
        }

        /* Hover transform/shadow are owned by the TiltCard mousemove handler
           (a cursor-follow 3D tilt needs per-pixel values a CSS :hover rule
           cannot express) -- no .price-card:hover rule here on purpose. */

        .contact-row { display: flex; flex-direction: column; gap: 12px; }
        @media (min-width: 560px) {
          .contact-row { flex-direction: row; }
        }

        .event-scene { position: relative; width: 512px; height: 752px; margin-top: 40px; flex-shrink: 0; }
        .event-stage {
          position: absolute; width: 96px; height: 145px; border-radius: 16px;
          background-size: cover; background-position: center 30%; background-color: #E4DED2;
          box-shadow: inset 0 0 0 1px rgba(33,31,29,0.06); overflow: hidden;
        }
        .event-flash { position: absolute; inset: 0; background: #FFFFFF; opacity: 0; }
        .event-flash-1 { animation: eventFlash1 10s ease-in-out infinite; }
        .event-flash-2 { animation: eventFlash2 10s ease-in-out infinite; }
        .event-flash-3 { animation: eventFlash3 10s ease-in-out infinite; }
        .event-flash-4 { animation: eventFlash4 10s ease-in-out infinite; }
        .event-flash-5 { animation: eventFlash5 10s ease-in-out infinite; }
        .event-flash-6 { animation: eventFlash6 10s ease-in-out infinite; }
        .event-flash-7 { animation: eventFlash7 10s ease-in-out infinite; }
        .event-flash-8 { animation: eventFlash8 10s ease-in-out infinite; }
        .event-flash-9 { animation: eventFlash9 10s ease-in-out infinite; }
        .event-flash-10 { animation: eventFlash10 10s ease-in-out infinite; }

        /* A high-tech landing zone for the photos to fall into -- a stylized
           monitor (bezel + glowing screen + stand) rather than a plain
           frame. Brushed-metal bezel gradient, a thin-bezel modern profile
           with a slightly deeper bottom chin (real monitors are never
           uniform on all four sides), a diagonal screen glare, and a
           centered logo dot push it further away from looking like a flat
           rectangle, toward actual hardware. */
        .event-monitor-bezel {
          position: absolute; left: 0; top: 318px; width: 512px; height: 120px; border-radius: 10px;
          background: linear-gradient(155deg, #4A453C, #221F1A 55%, #17140F);
          box-shadow: 0 14px 28px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .event-monitor-screen {
          position: absolute; left: 8px; top: 8px; right: 8px; bottom: 16px; border-radius: 5px;
          background: linear-gradient(160deg, #1C2128, #0B0D10);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 0 30px rgba(74,158,168,0.14);
          overflow: hidden;
        }
        .event-monitor-scanlines {
          position: absolute; inset: 0; pointer-events: none;
          background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px);
        }
        .event-monitor-glare {
          position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.05) 48%, transparent 62%);
        }
        .event-monitor-logo { position: absolute; left: 254px; bottom: 6px; width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.25); }
        .event-monitor-led { position: absolute; right: 14px; bottom: 5px; width: 5px; height: 5px; border-radius: 50%; background: #4A9EA8; animation: eventLedPulse 2.4s ease-in-out infinite; }
        .event-monitor-neck {
          position: absolute; left: 247px; top: 438px; width: 18px; height: 20px;
          background: linear-gradient(90deg, #211F1D, #3A362F 45%, #211F1D);
        }
        .event-monitor-base {
          position: absolute; left: 196px; top: 458px; width: 120px; height: 10px; border-radius: 5px;
          background: linear-gradient(160deg, #3A362F, #17140F);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 3px 8px rgba(0,0,0,0.25);
        }

        /* One photo lands per person, staggered across the loop, arriving
           in the same column under their stage (row-1 people land in the
           top half of the monitor screen, row-2 people in the bottom
           half), then all ten hold together near the end before the loop
           resets -- reads as the gallery filling up. These still use the
           low-quality photoRaw source, same as the stage cards -- only the
           video slideshow below gets the sharp version, since that is the
           finished, polished output. */
        .event-polaroid {
          position: absolute; width: 26px; height: 32px; border-radius: 3px;
          background: #FFFFFF; box-shadow: 0 4px 10px rgba(0,0,0,0.4);
          padding: 2px 2px 6px; box-sizing: border-box; z-index: 1;
        }
        .event-polaroid-photo { width: 100%; height: 100%; border-radius: 1px; background-size: cover; background-position: center 25%; }
        .event-polaroid-1 { left: 35px; top: 334px; animation: eventFly1 10s ease-in-out infinite; }
        .event-polaroid-2 { left: 139px; top: 334px; animation: eventFly2 10s ease-in-out infinite; }
        .event-polaroid-3 { left: 243px; top: 334px; animation: eventFly3 10s ease-in-out infinite; }
        .event-polaroid-4 { left: 347px; top: 334px; animation: eventFly4 10s ease-in-out infinite; }
        .event-polaroid-5 { left: 451px; top: 334px; animation: eventFly5 10s ease-in-out infinite; }
        .event-polaroid-6 { left: 35px; top: 382px; animation: eventFly6 10s ease-in-out infinite; }
        .event-polaroid-7 { left: 139px; top: 382px; animation: eventFly7 10s ease-in-out infinite; }
        .event-polaroid-8 { left: 243px; top: 382px; animation: eventFly8 10s ease-in-out infinite; }
        .event-polaroid-9 { left: 347px; top: 382px; animation: eventFly9 10s ease-in-out infinite; }
        .event-polaroid-10 { left: 451px; top: 382px; animation: eventFly10 10s ease-in-out infinite; }

        /* The video slideshow the monitor feeds into -- a real 16:9 preview
           (not a sliver) so the photo actually playing is clearly visible,
           cross-fading through all ten HIGH-quality photos with a
           scrubbing progress bar so it reads as playing rather than just
           another static frame. */
        .event-video { position: absolute; left: 20px; top: 484px; width: 472px; height: 266px; border-radius: 14px; border: 2px solid #C97A3D; background: #211F1D; overflow: hidden; }
        .event-video-slide { position: absolute; inset: 0; background-size: cover; background-position: center 22%; opacity: 0; }
        .event-video-slide-1 { animation: eventSlide1 10s ease-in-out infinite; }
        .event-video-slide-2 { animation: eventSlide2 10s ease-in-out infinite; }
        .event-video-slide-3 { animation: eventSlide3 10s ease-in-out infinite; }
        .event-video-slide-4 { animation: eventSlide4 10s ease-in-out infinite; }
        .event-video-slide-5 { animation: eventSlide5 10s ease-in-out infinite; }
        .event-video-slide-6 { animation: eventSlide6 10s ease-in-out infinite; }
        .event-video-slide-7 { animation: eventSlide7 10s ease-in-out infinite; }
        .event-video-slide-8 { animation: eventSlide8 10s ease-in-out infinite; }
        .event-video-slide-9 { animation: eventSlide9 10s ease-in-out infinite; }
        .event-video-slide-10 { animation: eventSlide10 10s ease-in-out infinite; }
        .event-video-play {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 52px; height: 52px; border-radius: 50%; background: rgba(255,255,255,0.85);
          color: #211F1D; font-size: 19px; display: flex; align-items: center; justify-content: center; padding-left: 3px;
        }
        .event-video-progress { position: absolute; left: 0; bottom: 0; height: 4px; background: #C97A3D; width: 0%; animation: eventProgress 10s ease-in-out infinite; }

        /* One flash pulse per phone, timed just before that persons
           eventFlyN pop-out moment. */
        @keyframes eventFlash1 { 0%, 2% { opacity: 0; } 4% { opacity: 0.85; } 7%, 100% { opacity: 0; } }
        @keyframes eventFlash2 { 0%, 9% { opacity: 0; } 11% { opacity: 0.85; } 14%, 100% { opacity: 0; } }
        @keyframes eventFlash3 { 0%, 18% { opacity: 0; } 20% { opacity: 0.85; } 23%, 100% { opacity: 0; } }
        @keyframes eventFlash4 { 0%, 27% { opacity: 0; } 29% { opacity: 0.85; } 32%, 100% { opacity: 0; } }
        @keyframes eventFlash5 { 0%, 36% { opacity: 0; } 38% { opacity: 0.85; } 41%, 100% { opacity: 0; } }
        @keyframes eventFlash6 { 0%, 45% { opacity: 0; } 47% { opacity: 0.85; } 50%, 100% { opacity: 0; } }
        @keyframes eventFlash7 { 0%, 54% { opacity: 0; } 56% { opacity: 0.85; } 59%, 100% { opacity: 0; } }
        @keyframes eventFlash8 { 0%, 63% { opacity: 0; } 65% { opacity: 0.85; } 68%, 100% { opacity: 0; } }
        @keyframes eventFlash9 { 0%, 72% { opacity: 0; } 74% { opacity: 0.85; } 77%, 100% { opacity: 0; } }
        @keyframes eventFlash10 { 0%, 81% { opacity: 0; } 83% { opacity: 0.85; } 86%, 100% { opacity: 0; } }
        @keyframes eventLedPulse {
          0%, 100% { opacity: 0.5; } 50% { opacity: 1; }
        }
        @keyframes eventFly1 {
          0%, 2% { opacity: 0; transform: translate(0, -260px) scale(0.35) rotate(0deg); }
          4% { opacity: 1; transform: translate(0, -260px) scale(0.5) rotate(0deg); }
          14% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(-4deg); }
        }
        @keyframes eventFly2 {
          0%, 11% { opacity: 0; transform: translate(0, -260px) scale(0.35) rotate(0deg); }
          13% { opacity: 1; transform: translate(0, -260px) scale(0.5) rotate(0deg); }
          23% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(3deg); }
        }
        @keyframes eventFly3 {
          0%, 20% { opacity: 0; transform: translate(0, -260px) scale(0.35) rotate(0deg); }
          22% { opacity: 1; transform: translate(0, -260px) scale(0.5) rotate(0deg); }
          32% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(-3deg); }
        }
        @keyframes eventFly4 {
          0%, 29% { opacity: 0; transform: translate(0, -260px) scale(0.35) rotate(0deg); }
          31% { opacity: 1; transform: translate(0, -260px) scale(0.5) rotate(0deg); }
          41% { opacity: 1; transform: translate(0, 0) scale(1) rotate(5deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(5deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(5deg); }
        }
        @keyframes eventFly5 {
          0%, 38% { opacity: 0; transform: translate(0, -260px) scale(0.35) rotate(0deg); }
          40% { opacity: 1; transform: translate(0, -260px) scale(0.5) rotate(0deg); }
          50% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-5deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-5deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(-5deg); }
        }
        @keyframes eventFly6 {
          0%, 47% { opacity: 0; transform: translate(0, -151px) scale(0.35) rotate(0deg); }
          49% { opacity: 1; transform: translate(0, -151px) scale(0.5) rotate(0deg); }
          59% { opacity: 1; transform: translate(0, 0) scale(1) rotate(4deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(4deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(4deg); }
        }
        @keyframes eventFly7 {
          0%, 56% { opacity: 0; transform: translate(0, -151px) scale(0.35) rotate(0deg); }
          58% { opacity: 1; transform: translate(0, -151px) scale(0.5) rotate(0deg); }
          68% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-4deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(-4deg); }
        }
        @keyframes eventFly8 {
          0%, 65% { opacity: 0; transform: translate(0, -151px) scale(0.35) rotate(0deg); }
          67% { opacity: 1; transform: translate(0, -151px) scale(0.5) rotate(0deg); }
          77% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(3deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(3deg); }
        }
        @keyframes eventFly9 {
          0%, 74% { opacity: 0; transform: translate(0, -151px) scale(0.35) rotate(0deg); }
          76% { opacity: 1; transform: translate(0, -151px) scale(0.5) rotate(0deg); }
          86% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(-3deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(-3deg); }
        }
        @keyframes eventFly10 {
          0%, 83% { opacity: 0; transform: translate(0, -151px) scale(0.35) rotate(0deg); }
          85% { opacity: 1; transform: translate(0, -151px) scale(0.5) rotate(0deg); }
          95% { opacity: 1; transform: translate(0, 0) scale(1) rotate(5deg); }
          97% { opacity: 1; transform: translate(0, 0) scale(1) rotate(5deg); }
          100% { opacity: 0; transform: translate(0, 0) scale(1) rotate(5deg); }
        }
        @keyframes eventSlide1 { 0%, 2% { opacity: 0; } 5%, 9% { opacity: 1; } 12%, 100% { opacity: 0; } }
        @keyframes eventSlide2 { 0%, 11% { opacity: 0; } 14%, 18% { opacity: 1; } 21%, 100% { opacity: 0; } }
        @keyframes eventSlide3 { 0%, 20% { opacity: 0; } 23%, 27% { opacity: 1; } 30%, 100% { opacity: 0; } }
        @keyframes eventSlide4 { 0%, 29% { opacity: 0; } 32%, 36% { opacity: 1; } 39%, 100% { opacity: 0; } }
        @keyframes eventSlide5 { 0%, 38% { opacity: 0; } 41%, 45% { opacity: 1; } 48%, 100% { opacity: 0; } }
        @keyframes eventSlide6 { 0%, 47% { opacity: 0; } 50%, 54% { opacity: 1; } 57%, 100% { opacity: 0; } }
        @keyframes eventSlide7 { 0%, 56% { opacity: 0; } 59%, 63% { opacity: 1; } 66%, 100% { opacity: 0; } }
        @keyframes eventSlide8 { 0%, 65% { opacity: 0; } 68%, 72% { opacity: 1; } 75%, 100% { opacity: 0; } }
        @keyframes eventSlide9 { 0%, 74% { opacity: 0; } 77%, 81% { opacity: 1; } 84%, 100% { opacity: 0; } }
        @keyframes eventSlide10 { 0%, 83% { opacity: 0; } 86%, 90% { opacity: 1; } 93%, 100% { opacity: 0; } }
        @keyframes eventProgress {
          0% { width: 0%; } 97% { width: 100%; } 100% { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .event-flash, .event-polaroid, .event-video-slide, .event-video-progress, .event-monitor-led { animation: none !important; }
          .event-flash { opacity: 0; }
          .event-polaroid { opacity: 1; transform: translate(0,0) scale(1) rotate(-4deg); }
          .event-video-slide-1 { opacity: 1; }
          .event-video-progress { width: 45%; }
          .event-monitor-led { opacity: 1; }
        }
        @media (max-width: 620px) {
          /* transform: scale() shrinks how the element RENDERS but not the
             752px of vertical space it still RESERVES in the flex layout --
             without the matching negative margin, everything after this
             scene (How It Works, etc.) sat behind a large blank gap equal
             to the unused reserved space below the now-smaller visual. */
          .event-scene { transform: scale(0.76); transform-origin: top center; margin-bottom: -180px; }
        }
        @media (max-width: 460px) {
          .event-scene { transform: scale(0.66); transform-origin: top center; margin-bottom: -256px; }
        }

      `}</style>

      <main>
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px 56px", textAlign: "center", position: "relative", backgroundImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #FBEEE0, transparent)" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: 16 }}>
          Event recap videos & photo galleries
        </p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 40, lineHeight: 1.15, margin: "0 0 18px" }}>
          From your camera roll to a full production.
        </h1>
        <p style={{ fontSize: 16, color: "#4a4642", lineHeight: 1.6, margin: "0 0 32px" }}>
          You and your guests upload the photos. We polish every shot and turn them into a full recap video, ready-to-post social cuts, and a photo gallery — no photographer required.
        </p>
        <a href="/booking" className="press-btn" style={{ display: "inline-flex", alignItems: "center", gap: 8, backgroundImage: "linear-gradient(135deg, #C97A3D, #E0985A)", color: "#211F1D", fontSize: 15, fontWeight: 700, padding: "14px 26px", borderRadius: 10, textDecoration: "none", boxShadow: "0 8px 22px rgba(201,122,61,0.28)" }}>
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

        <div style={{ display: "flex", justifyContent: "center", overflowX: "hidden" }}>
          <EventPhotoScene />
        </div>
      </section>

      <Section id="how" refs={sectionRefs} title="How It Works" icon={<Camera size={20} color="#C97A3D" />}
        blob={{ color: "#C97A3D", top: -50, right: 0, size: 260 }}
        subtitle="Every guest already has a camera in their pocket. Four simple steps turn what they capture into one story worth watching — you never touch an edit.">
        <div className="how-timeline">
          {[
            { n: "1", icon: Calendar, t: "Book", d: "Pick your package and event date — takes less than 2 minutes." },
            { n: "2", icon: QrCode, t: "Everyone pitches in", d: "Share your QR code digitally or print it on cards. Guests add photos with zero apps and zero fuss, and you can toss in your own from the same page." },
            { n: "3", icon: Wand2, t: "We do the editing", d: "Once uploads close, hundreds of photos become one story. We find the moments worth keeping — the real laugh, not the posed one — then cut, grade, and pace them together automatically, start to finish." },
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
      </Section>

      <Section id="services" refs={sectionRefs} title="Pricing" icon={<Sparkles size={20} color="#C97A3D" />} band="white"
        subtitle="Start for free, or pick the tier that matches how much of the event you want captured.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 20, padding: "6px 4px" }}>
          {TIERS.map((t, idx) => {
            const TierIcon = TIER_ICONS[t.id] || Sparkles;
            const tilt = [-1.3, 0.9, 0, -0.7][idx] || 0;
            const baseTransform = t.highlight ? "scale(1.03)" : `rotate(${tilt}deg)`;
            return (
            <TiltCard key={t.id} href={`/booking?tier=${t.id}`} className="price-card" baseTransform={baseTransform} style={{
              ...cardStyle, position: "relative", display: "block", textDecoration: "none", color: "inherit", cursor: "pointer",
              border: t.highlight ? "1.5px solid #C97A3D" : cardStyle.border,
              boxShadow: t.highlight ? "0 10px 26px rgba(201,122,61,0.22)" : "0 3px 10px rgba(33,31,29,0.05)",
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
                <span style={{ color: "#C97A3D", fontWeight: 700 }}><CountUpPrice value={t.price} /></span>
              </div>
              <p style={{ fontSize: 13, color: "#4a4642", margin: "0 0 12px" }}>{t.tagline}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: "#6b655c" }}>
                {t.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                    <Check size={13} color="#7A8B76" style={{ flexShrink: 0, marginTop: 2 }} /> {f}
                  </li>
                ))}
              </ul>
            </TiltCard>
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
            Witty, affectionate commentary layered over your photos — you pick how far to take it, and you'll always get a caption-free version of the same video alongside it. Available on Signature and Luxe for any event type.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Light Roasting", desc: "Playful, gentle teasing" },
              { label: "Lukewarm Roasting", desc: "Sharper, inside-joke energy" },
              { label: "Hot Roasting", desc: "Full send, thick skin required" },
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
              <button key={e.label} onClick={() => scrollTo("contact")} className="press-btn"
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
        blob={{ color: "#7A8B76", top: -40, left: 0, size: 240 }}
        subtitle="Everything we get asked before someone books — answered upfront.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {FAQS.map((f, i) => {
            const isOpen = openFaq === i;
            return (
            <div key={i} style={{ ...cardStyle, padding: 0, borderLeft: isOpen ? "3px solid #C97A3D" : "1px solid #E4DED2", background: isOpen ? "#FFFDF9" : cardStyle.background, transition: "border-color 0.2s, background 0.2s" }}>
              <button onClick={() => setOpenFaq(isOpen ? null : i)} aria-expanded={isOpen} className="press-btn"
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
            Living in New York City means never running out of moments worth keeping — a wedding one weekend, a rooftop birthday the next, a block party you wandered into and didn't want to leave. The city hands you memories faster than you can hold onto them.
          </p>
          <p style={{ fontSize: 14.5, color: "#4a4642", lineHeight: 1.7, marginBottom: 16 }}>
            That's exactly why Recapped For You exists. After enough events — daytime brunches, all-night celebrations, everything in between — we kept seeing the same thing: the best moments ended up scattered across everyone's camera rolls, and most of it never got looked at twice. So we set out to build something that could gather it all, make sense of it, and hand it back looking as good as it felt being there — a photo gallery, social cuts, and one polished film worth watching. Every photo is scored the moment it lands, for focus, light, and the split-second energy that makes a moment worth keeping, then cleaned up, color graded, and cut into a film — the same polish and curation a professional editor would give it, built into everything we deliver.
          </p>
          <p style={{ fontSize: 14.5, color: "#4a4642", lineHeight: 1.7 }}>
            Taste isn't a mood or a deadline here — it's built into the process, so the story you get back is exactly as good on a Tuesday as it is on a Saturday.
          </p>
        </div>
      </Section>
      <Section id="contact" refs={sectionRefs} title="Get In Touch" icon={<Mail size={20} color="#C97A3D" />} band="white"
        blob={{ color: "#C97A3D", top: -50, right: 0, size: 240 }}
        subtitle="Have a corporate event, or just a question? Reach out.">
        <div className="contact-row">
          <a href="mailto:hello@recappedforyou.com" className="press-btn" style={{ ...cardStyle, flex: 1, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #C97A3D, #E0985A)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(201,122,61,0.32)" }}>
              <Mail size={18} color="#FFFFFF" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Email</div>
              <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>hello@recappedforyou.com</div>
            </div>
          </a>
          <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" className="press-btn" style={{ ...cardStyle, flex: 1, display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
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

// Illustrates the actual thing this product does: ten guests at the SAME
// daytime backyard party each snap a phone photo, and those photos get cut
// into one polished video. The stage card shows the guest holding their
// phone up (stagePhoto) -- what the polaroid and video show is a DIFFERENT
// photo, the actual moment that guest is capturing (scenePhotoRaw /
// scenePhotoHQ), not another shot of the guest themselves -- the same
// distinction as a photographer versus what is in their frame. Stage cards
// and polaroids use an ordinary, unedited-looking version of each photo --
// a real casual phone photo, not a professional shot, but not artificially
// degraded either. The video slideshow at the bottom is the only place the
// sharp, high-quality version shows up, since that is the finished,
// polished output -- the whole point being shown, not just described.
// These stills are AI-generated portraits (not real customer photos, not
// real people) -- picked deliberately generic/anonymous rather than
// anything that could be mistaken for actual event footage, since real,
// unedited guest uploads are what the product itself delivers (see the
// Real footage, never generated badge above).
const EVENT_SCENES = [
  { id: 1, x: 0, y: 0, stagePhoto: "/images/hero-1-raw.jpg", scenePhotoRaw: "/images/scene-1-raw.jpg", scenePhotoHQ: "/images/scene-1.jpg" },
  { id: 2, x: 104, y: 0, stagePhoto: "/images/hero-2-raw.jpg", scenePhotoRaw: "/images/scene-2-raw.jpg", scenePhotoHQ: "/images/scene-2.jpg" },
  { id: 3, x: 208, y: 0, stagePhoto: "/images/hero-3-raw.jpg", scenePhotoRaw: "/images/scene-3-raw.jpg", scenePhotoHQ: "/images/scene-3.jpg" },
  { id: 4, x: 312, y: 0, stagePhoto: "/images/hero-4-raw.jpg", scenePhotoRaw: "/images/scene-4-raw.jpg", scenePhotoHQ: "/images/scene-4.jpg" },
  { id: 5, x: 416, y: 0, stagePhoto: "/images/hero-5-raw.jpg", scenePhotoRaw: "/images/scene-5-raw.jpg", scenePhotoHQ: "/images/scene-5.jpg" },
  { id: 6, x: 0, y: 157, stagePhoto: "/images/hero-6-raw.jpg", scenePhotoRaw: "/images/scene-6-raw.jpg", scenePhotoHQ: "/images/scene-6.jpg" },
  { id: 7, x: 104, y: 157, stagePhoto: "/images/hero-7-raw.jpg", scenePhotoRaw: "/images/scene-7-raw.jpg", scenePhotoHQ: "/images/scene-7.jpg" },
  { id: 8, x: 208, y: 157, stagePhoto: "/images/hero-8-raw.jpg", scenePhotoRaw: "/images/scene-8-raw.jpg", scenePhotoHQ: "/images/scene-8.jpg" },
  { id: 9, x: 312, y: 157, stagePhoto: "/images/hero-9-raw.jpg", scenePhotoRaw: "/images/scene-9-raw.jpg", scenePhotoHQ: "/images/scene-9.jpg" },
  { id: 10, x: 416, y: 157, stagePhoto: "/images/hero-10-raw.jpg", scenePhotoRaw: "/images/scene-10-raw.jpg", scenePhotoHQ: "/images/scene-10.jpg" },
];

function EventPhotoScene() {
  return (
    <div className="event-scene" role="img" aria-label="Animated illustration of ten guests at a daytime party each taking a phone photo of the moment in front of them, which falls into a monitor screen as a polaroid, then plays as a polished video slideshow below it">
      {EVENT_SCENES.map((s) => (
        <div key={s.id} className="event-stage" style={{ left: s.x, top: s.y, backgroundImage: `url(${s.stagePhoto})` }}>
          <div className={`event-flash event-flash-${s.id}`} />
        </div>
      ))}

      <div className="event-monitor-bezel" aria-hidden="true">
        <div className="event-monitor-screen">
          <div className="event-monitor-scanlines" />
          <div className="event-monitor-glare" />
        </div>
        <div className="event-monitor-logo" />
        <div className="event-monitor-led" />
      </div>
      <div className="event-monitor-neck" aria-hidden="true" />
      <div className="event-monitor-base" aria-hidden="true" />

      {EVENT_SCENES.map((s) => (
        <div key={`polaroid-${s.id}`} className={`event-polaroid event-polaroid-${s.id}`}>
          <div className="event-polaroid-photo" style={{ backgroundImage: `url(${s.scenePhotoRaw})` }} />
        </div>
      ))}

      <div className="event-video" aria-hidden="true">
        {EVENT_SCENES.map((s) => (
          <div key={`slide-${s.id}`} className={`event-video-slide event-video-slide-${s.id}`} style={{ backgroundImage: `url(${s.scenePhotoHQ})` }} />
        ))}
        <span className="event-video-play">▶</span>
        <div className="event-video-progress" />
      </div>
    </div>
  );
}

// Cursor-follow 3D tilt for the pricing cards -- rotates on X/Y based on
// pointer position within the card, snapping back to baseTransform (each
// card's static scattered-photo rotation, or the highlight card's scale)
// on mouse leave. Mutates the DOM node directly via a ref instead of React
// state: a mousemove-driven re-render on every pixel of cursor movement
// would be needlessly expensive for a purely visual effect nothing else
// reads. Skipped under prefers-reduced-motion, same as the hero's own
// animations elsewhere on this page -- a cursor-controlled 3D rotation is
// exactly the kind of motion that setting exists to opt out of.
function TiltCard({ href, className, style, baseTransform, children }) {
  const cardRef = useRef(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const handleMouseMove = (e) => {
    if (reducedMotionRef.current) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 14;
    const rotateX = (0.5 - py) * 14;
    card.style.transition = "box-shadow 0.25s ease";
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px) scale(1.02)`;
    card.style.boxShadow = "0 16px 32px rgba(33,31,29,0.15)";
  };

  const handleMouseLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "transform 0.4s ease, box-shadow 0.3s ease";
    card.style.transform = baseTransform;
    card.style.boxShadow = style.boxShadow;
  };

  return (
    <Link ref={cardRef} href={href} className={className} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
      style={{ ...style, transform: baseTransform }}>
      {children}
    </Link>
  );
}

// Counts a tier's price up from $0 to its real value the first time it
// scrolls into view, instead of just appearing. Renders "$0" on both server
// and initial client paint (identical, no hydration risk) -- the count-up
// itself only ever runs after mount, inside an effect. Skips straight to
// the final value under prefers-reduced-motion.
function CountUpPrice({ value, duration = 800 }) {
  const target = parseInt(value.replace(/[^0-9]/g, ""), 10) || 0;
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || startedRef.current) return;
        startedRef.current = true;
        const startTime = performance.now();
        const tick = (now) => {
          const progress = Math.min((now - startTime) / duration, 1);
          setDisplay(Math.round(progress * target));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        observer.disconnect();
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return <span ref={ref}>${display}</span>;
}

const BAND_COLORS = { white: "#FFFFFF", tint: "#FBEEE0" };

// Fades + slides a section up into place the first time it scrolls into
// view, rather than everything just appearing instantly on load -- the
// hero's own animation is the only dynamic thing on the page otherwise.
// Reveals once and stays revealed (observer disconnects after triggering),
// so scrolling back up never re-hides content. Skips the animation
// entirely under prefers-reduced-motion, same consideration already given
// to the hero's own CSS animations further up this file.
function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -80px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

function Section({ id, refs, title, icon, children, subtitle, band, blob }) {
  const { ref: revealRef, visible } = useScrollReveal();
  const setRefs = (el) => {
    revealRef.current = el;
    refs.current[id] = el;
  };

  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subtitle ? 10 : 24 }}>
        {icon}
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: 0 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 15, color: "#6b655c", margin: "0 0 28px", maxWidth: 520, lineHeight: 1.5 }}>{subtitle}</p>}
      {children}
    </>
  );

  const content = (
    <section ref={setRefs} id={id} style={{
      position: "relative", maxWidth: 900, margin: "0 auto", padding: "56px 24px", scrollMarginTop: 70,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(28px)",
      transition: "opacity 0.7s ease, transform 0.7s ease",
    }}>
      {/* A soft, low-opacity blurred color blob behind the heading -- purely
          decorative depth, not a hard shape, so it stays out of the way of
          reading the content. Kept off Pricing (already busy with the card
          tilt effect) and About (already has its own tint band + quote
          watermark). */}
      {blob && (
        <div aria-hidden="true" style={{
          position: "absolute", top: blob.top ?? -60, left: blob.left, right: blob.right,
          width: blob.size ?? 260, height: blob.size ?? 260, borderRadius: "50%",
          background: blob.color, filter: "blur(70px)", opacity: 0.22, pointerEvents: "none", zIndex: 0,
        }} />
      )}
      {blob ? <div style={{ position: "relative", zIndex: 1 }}>{inner}</div> : inner}
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
