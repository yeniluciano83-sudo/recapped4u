"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Download, Play, Image as ImageIcon, Share2, Clock, X } from "lucide-react";

export default function GalleryDeliveryPage() {
  const params = useParams();
  const bookingId = params?.bookingId;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [videoLength, setVideoLength] = useState("full");

  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/gallery/${bookingId}`)
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch((err) => console.error("Failed to load gallery", err))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
        Loading your recap…
      </div>
    );
  }

  const booking = data?.booking || {};
  const photos = data?.photos || [];
  const eventName = booking.host_name ? `${booking.host_name}'s ${booking.event_type}` : "Your Recap";

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>Your recap is ready</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "32px", margin: "0 0 8px", lineHeight: 1.15 }}>{eventName}</h1>
          <p style={{ fontSize: "14px", color: "#a8a29a", margin: 0 }}>{booking.event_date}</p>
        </div>

        <div style={{ background: "#2a2723", borderRadius: "18px", border: "1px solid #3a3733", overflow: "hidden", marginBottom: "16px" }}>
          <div style={{ aspectRatio: "16/9", background: "linear-gradient(135deg, #332e28, #211F1D)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" }}
            onClick={() => { const url = videoLength === "full" ? data?.deliverable?.full_video_url : data?.deliverable?.social_video_url; if (url) window.open(url, "_blank"); }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Play size={26} color="#211F1D" fill="#211F1D" style={{ marginLeft: "3px" }} />
            </div>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <LengthToggle active={videoLength === "full"} onClick={() => setVideoLength("full")} label="Full cut" />
              <LengthToggle active={videoLength === "social"} onClick={() => setVideoLength("social")} label="Social cut" />
            </div>
            <a href={videoLength === "full" ? data?.deliverable?.full_video_url : data?.deliverable?.social_video_url} download style={iconBtnStyle}>
              <Download size={16} /> Download
            </a>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "13px", color: "#6a655e", marginBottom: "40px" }}>
          Edited by your Recapped For You editor · {booking.style} style
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <ImageIcon size={18} color="#C97A3D" /> Photo gallery
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "36px" }}>
          {photos.map((url, i) => (
            <button key={i} onClick={() => setLightbox(url)} style={{ aspectRatio: "1", borderRadius: "8px", border: "none", cursor: "pointer", backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <button style={{ width: "100%", padding: "14px", borderRadius: "10px", border: "1px solid #4a4642", background: "transparent", color: "#F7F3EC", fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", cursor: "pointer" }}>
            <Share2 size={16} /> Share this gallery
          </button>
          <div style={{ padding: "14px 16px", background: "#2a2723", borderRadius: "10px", border: "1px solid #3a3733", display: "flex", gap: "10px" }}>
            <Clock size={16} color="#C97A3D" style={{ flexShrink: 0, marginTop: "1px" }} />
            <p style={{ fontSize: "12.5px", color: "#a8a29a", margin: 0, lineHeight: 1.6 }}>
              This gallery and video stay available for 90 days after delivery. Please download everything you'd like to keep — raw guest uploads have already been removed per our data policy.
            </p>
          </div>
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "24px" }}>
          <button onClick={() => setLightbox(null)} style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", color: "#F7F3EC", cursor: "pointer" }}><X size={26} /></button>
          <img src={lightbox} alt="" style={{ width: "min(500px, 90vw)", borderRadius: "14px" }} />
        </div>
      )}
    </div>
  );
}

function LengthToggle({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{ padding: "7px 13px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", border: active ? "1px solid #C97A3D" : "1px solid #4a4642", background: active ? "#332e28" : "transparent", color: active ? "#C97A3D" : "#8a857d" }}>
      {label}
    </button>
  );
}

const iconBtnStyle = { display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px", border: "1px solid #4a4642", background: "transparent", color: "#a8a29a", fontSize: "13px", cursor: "pointer", textDecoration: "none" };
