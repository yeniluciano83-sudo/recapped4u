"use client";
import { useEffect } from "react";

// Only fires when the root layout itself throws -- error.jsx can't catch
// that since it renders inside the layout. Next.js requires this to render
// its own <html>/<body>, so it can't reuse RootLayout (the font variable,
// colorScheme, etc.) the way every other page does.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <body style={{ colorScheme: "light", margin: 0 }}>
        <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
          <div style={{ textAlign: "center", maxWidth: 380 }}>
            <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>Recapped For You</p>
            <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: 28, margin: "0 0 10px" }}>Something went wrong</h1>
            <p style={{ color: "#4a4642", fontSize: "14.5px", lineHeight: 1.6, margin: "0 0 24px" }}>
              An unexpected error occurred. Try again, or head back to the homepage.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => reset()} style={{ background: "#C97A3D", color: "#211F1D", fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 10, border: "none", cursor: "pointer" }}>
                Try again
              </button>
              <a href="/" style={{ display: "inline-block", background: "#FFFFFF", border: "1px solid #E4DED2", color: "#211F1D", fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 10, textDecoration: "none" }}>
                Back to homepage
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
