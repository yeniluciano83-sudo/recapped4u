import React, { useState } from "react";
import { Download, Play, Image as ImageIcon, Film, Share2, Clock, X } from "lucide-react";

// bg: #211F1D / ivory: #F7F3EC / amber: #C97A3D / sage: #7A8B76

const EVENT_NAME = "Maya's 30th Birthday";
const EVENT_DATE = "August 22, 2026";
const DELIVERED_DATE = "August 25, 2026";
const EXPIRES_DATE = "November 23, 2026";

// Placeholder gallery data — in production these would be real signed URLs from storage
const PHOTOS = Array.from({ length: 12 }).map((_, i) => ({
  id: i,
  color: ["#C97A3D", "#7A8B76", "#8B6F47", "#5A6B56", "#B8905C"][i % 5],
}));

export default function GalleryDeliveryPage() {
  const [lightbox, setLightbox] = useState(null);
  const [videoLength, setVideoLength] = useState("full");

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 20px 80px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>
            Your recap is ready
          </p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "32px", margin: "0 0 8px", lineHeight: 1.15 }}>
            {EVENT_NAME}
          </h1>
          <p style={{ fontSize: "14px", color: "#a8a29a", margin: 0 }}>{EVENT_DATE}</p>
        </div>

        {/* Video player */}
        <div
          style={{
            background: "#2a2723", borderRadius: "18px", border: "1px solid #3a3733",
            overflow: "hidden", marginBottom: "16px",
          }}
        >
          <div
            style={{
              aspectRatio: "16/9", background: "linear-gradient(135deg, #332e28, #211F1D)",
              display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 64, height: 64, borderRadius: "50%", background: "#C97A3D",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Play size={26} color="#211F1D" fill="#211F1D" style={{ marginLeft: "3px" }} />
            </div>
            <span style={{ position: "absolute", bottom: 14, right: 16, fontSize: "12px", color: "#a8a29a", background: "rgba(0,0,0,0.4)", padding: "3px 8px", borderRadius: "6px" }}>
              {videoLength === "full" ? "6:42" : "0:58"}
            </span>
          </div>

          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <LengthToggle active={videoLength === "full"} onClick={() => setVideoLength("full")} label="Full cut" />
              <LengthToggle active={videoLength === "social"} onClick={() => setVideoLength("social")} label="Social cut" />
            </div>
            <button style={iconBtnStyle}>
              <Download size={16} /> Download
            </button>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "13px", color: "#6a655e", marginBottom: "40px" }}>
          Edited by your Recapped For You editor · Cinematic style
        </p>

        {/* Photo gallery */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <ImageIcon size={18} color="#C97A3D" /> Photo gallery
          </h2>
          <button style={iconBtnStyle}>
            <Download size={14} /> Download all
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "36px" }}>
          {PHOTOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setLightbox(p)}
              style={{
                aspectRatio: "1", borderRadius: "8px", border: "none", cursor: "pointer",
                background: `linear-gradient(150deg, ${p.color}, #211F1D)`,
              }}
            />
          ))}
        </div>

        {/* Share + retention notice */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            style={{
              width: "100%", padding: "14px", borderRadius: "10px", border: "1px solid #4a4642",
              background: "transparent", color: "#F7F3EC", fontSize: "14px", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", cursor: "pointer",
            }}
          >
            <Share2 size={16} /> Share this gallery
          </button>

          <div style={{ padding: "14px 16px", background: "#2a2723", borderRadius: "10px", border: "1px solid #3a3733", display: "flex", gap: "10px" }}>
            <Clock size={16} color="#C97A3D" style={{ flexShrink: 0, marginTop: "1px" }} />
            <p style={{ fontSize: "12.5px", color: "#a8a29a", margin: 0, lineHeight: 1.6 }}>
              Delivered {DELIVERED_DATE}. This gallery and video stay available until{" "}
              <strong style={{ color: "#F7F3EC" }}>{EXPIRES_DATE}</strong>. Please download everything you'd like to
              keep before then — raw guest uploads have already been removed per our data policy.
            </p>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "24px" }}
        >
          <button onClick={() => setLightbox(null)} style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", color: "#F7F3EC", cursor: "pointer" }}>
            <X size={26} />
          </button>
          <div
            style={{
              width: "min(500px, 90vw)", aspectRatio: "1", borderRadius: "14px",
              background: `linear-gradient(150deg, ${lightbox.color}, #211F1D)`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function LengthToggle({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 13px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
        border: active ? "1px solid #C97A3D" : "1px solid #4a4642",
        background: active ? "#332e28" : "transparent",
        color: active ? "#C97A3D" : "#8a857d",
      }}
    >
      {label}
    </button>
  );
}

const iconBtnStyle = {
  display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px",
  border: "1px solid #4a4642", background: "transparent", color: "#a8a29a", fontSize: "13px", cursor: "pointer",
};
