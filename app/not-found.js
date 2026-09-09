import { ImageOff } from "lucide-react";
import { tone, radius, shadow } from "@/components/ui";

// The one page on the site that had never been touched -- a bare triangle
// icon and grey text while every other page (including error states)
// got real treatment this session. "This memory doesn't exist" leans into
// what the product actually is instead of a generic 404: a dashed, slightly
// tilted photo frame (an empty spot in an album) rather than a warning icon,
// settling into place the way a printed photo would land on a table.
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: tone.cream, color: tone.ink, fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        .nf-in { animation: nf-fade-in 0.5s ease-out both; }
        .nf-frame { animation: nf-settle 0.6s 0.1s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        @keyframes nf-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes nf-settle {
          from { opacity: 0; transform: rotate(-9deg) translateY(-14px) scale(0.9); }
          to { opacity: 1; transform: rotate(-4deg) translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nf-in, .nf-frame { animation: none; }
          .nf-frame { transform: rotate(-4deg); }
        }
      `}</style>
      <div className="nf-in" style={{ textAlign: "center", maxWidth: 380 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: tone.sage, fontWeight: 600, margin: "0 0 22px" }}>Recapped For You</p>
        <div
          className="nf-frame"
          style={{
            width: 92, height: 92, margin: "0 auto 22px", background: tone.surface,
            border: `1.5px dashed ${tone.lineStrong}`, borderRadius: radius.sm, boxShadow: shadow.md,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <ImageOff size={30} color={tone.clay} strokeWidth={1.6} />
        </div>
        <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(24px, 3.2vw, 30px)", margin: "0 0 10px" }}>This memory doesn't exist</h1>
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          The page you're looking for doesn't exist, or the link might be out of date.
        </p>
        <a href="/" style={{ display: "inline-block", background: tone.clay, color: tone.ink, fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: radius.md, textDecoration: "none" }}>
          Back to homepage
        </a>
      </div>
    </main>
  );
}
