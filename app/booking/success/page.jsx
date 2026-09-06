"use client";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { LoadingState, tone } from "@/components/ui";

// A one-time celebratory burst -- this is the literal purchase-confirmation
// moment in the funnel, the one spot on the site where a bit of delight
// earns its keep rather than becoming an annoyance seen over and over.
// Colors come from the site's own palette, not a generic rainbow, so it
// reads as this brand celebrating rather than a stock effect bolted on.
//
// Hand-built rather than a library -- ~18 spans and one shared keyframe
// isn't worth a dependency for. Trajectories are computed in JS
// (Math.cos/sin), not CSS trig functions in calc(), which have shakier
// browser support; a plain --tx/--ty custom property works everywhere a
// custom property does.
const CONFETTI_COLORS = [tone.clay, tone.clayLight, tone.sage, tone.surface];

function ConfettiBurst() {
  // Skipped entirely under reduced motion, not just left un-animated --
  // unlike an informational transition (the hero crossfade, the lightbox),
  // confetti carries no information, so there's nothing worth keeping
  // visible in a static form. Computed once via the lazy initializer so it
  // doesn't re-roll on every re-render of the page around it.
  const [particles] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return [];
    return Array.from({ length: 18 }, (_, i) => {
      // Roughly even spread around the circle, jittered so 18 particles
      // don't read as a mechanical, evenly-spaced ring.
      const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.6;
      const distance = 70 + Math.random() * 50;
      return {
        id: i,
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        rot: (Math.random() - 0.5) * 480,
        size: 5 + Math.random() * 4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 80,
        round: i % 3 === 0,
      };
    });
  });

  if (particles.length === 0) return null;

  return (
    <>
      {particles.map((p) => (
        <span
          key={p.id}
          aria-hidden="true"
          style={{
            position: "absolute", top: "50%", left: "50%", width: p.size, height: p.size,
            background: p.color, borderRadius: p.round ? "50%" : 2,
            "--tx": `${p.tx}px`, "--ty": `${p.ty}px`, "--rot": `${p.rot}deg`,
            animation: `confetti-burst 900ms ease-out ${p.delay}ms both`,
          }}
        />
      ))}
    </>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const isEmailConfirm = searchParams.get("type") === "email";

  return (
    <div style={{ textAlign: "center", maxWidth: 420 }}>
      <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto 24px" }}>
        <div className="success-pop" style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check size={30} color="#211F1D" strokeWidth={2.5} />
        </div>
        <ConfettiBurst />
      </div>
      <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(24px, 3.2vw, 30px)", margin: "0 0 12px" }}>{isEmailConfirm ? "Booking activated" : "Payment confirmed"}</h1>
      <p style={{ color: "#4a4642", fontSize: "15px", lineHeight: 1.6, margin: 0 }}>
        Your booking is complete. Check your email for your guest upload link and confirmation details.
      </p>
      {bookingId && (
        <p style={{ color: "#8a857d", fontSize: "12px", marginTop: "20px" }}>
          Booking reference: {bookingId}
        </p>
      )}
      <a href="/" style={{ display: "inline-block", marginTop: "28px", background: "#C97A3D", color: "#211F1D", fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 10, textDecoration: "none" }}>
        Back to homepage
      </a>
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        .success-pop { animation: success-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes success-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .success-pop { animation: none; } }

        /* Each particle starts centered on the checkmark badge (its own
           top:50%/left:50% plus this base translate(-50%,-50%)), then flies
           out to its own --tx/--ty offset while fading and spinning. See
           ConfettiBurst above -- the component itself skips rendering these
           spans entirely under reduced motion, so no reduced-motion override
           is needed here the way every other animation on the site has one. */
        @keyframes confetti-burst {
          0% { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      <Suspense fallback={<LoadingState icon={Check} label="Loading…" />}>
        <SuccessContent />
      </Suspense>
    </main>
  );
}
