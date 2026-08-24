import { ImageResponse } from "next/og";

export const alt = "Recapped For You — Your event, recapped.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
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
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            background: "#C97A3D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 40,
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 8, border: "6px solid #FAF7F2" }} />
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, color: "#211F1D", marginBottom: 16 }}>Recapped For You</div>
        <div style={{ fontSize: 30, color: "#4a4642" }}>Phone photos in. A full production out.</div>
      </div>
    ),
    { ...size }
  );
}
