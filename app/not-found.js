export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>Recapped For You</p>
        <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(24px, 3.2vw, 30px)", margin: "0 0 10px" }}>Page not found</h1>
        <p style={{ color: "#4a4642", fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
          The page you're looking for doesn't exist, or the link might be out of date.
        </p>
        <a href="/" style={{ display: "inline-block", background: "#C97A3D", color: "#211F1D", fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 10, textDecoration: "none" }}>
          Back to homepage
        </a>
      </div>
    </main>
  );
}
