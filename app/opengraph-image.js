import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// @vercel/og's bundled default font fails to load on Windows dev paths
// containing spaces (ERR_INVALID_URL) -- supplying our own font avoids
// that code path entirely, and works the same in production. Pinned to
// Google Fonts' latin-subset Inter Bold woff2 (v20); update this URL if
// Google rotates it and the image starts rendering with a fallback font.
const INTER_BOLD_URL = "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hiA.woff2";

export default async function Image() {
  const interBold = await fetch(INTER_BOLD_URL).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FAF7F2",
          fontFamily: "Inter",
        }}
      >
        <div style={{ fontSize: 22, letterSpacing: 4, textTransform: "uppercase", color: "#7A8B76", fontWeight: 700, marginBottom: 20 }}>
          Recapped For You
        </div>
        <div style={{ fontSize: 64, color: "#211F1D", fontWeight: 700, textAlign: "center", padding: "0 100px", lineHeight: 1.15 }}>
          Your event, recapped - no photographer needed.
        </div>
        <div style={{ fontSize: 26, color: "#4a4642", marginTop: 28, fontWeight: 700 }}>
          Event recap videos & photo galleries
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: interBold, style: "normal", weight: 700 }] }
  );
}
