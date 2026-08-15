"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Download, Share2, Printer, Copy, Check } from "lucide-react";

export default function QrSharePage() {
  const params = useParams();
  const slug = params?.slug;

  const [eventInfo, setEventInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}`);
      const data = await res.json();
      setEventInfo(data.event || null);
    } catch (err) {
      console.error("Failed to load event info", err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (slug) load(); }, [slug, load]);

  const qrImageUrl = slug ? `/api/qrcode/${slug}` : "";
  const uploadUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/event/${slug}` : "";
  const eventName = eventInfo ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "";

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: eventName, text: `Add your photos and videos to ${eventName}`, url: uploadUrl });
      } catch (err) {
        // user cancelled the native share sheet — nothing to do
      }
    } else {
      handleCopy();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(uploadUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
        Loading…
      </div>
    );
  }

  if (!eventInfo) {
    return (
      <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
        Event not found.
      </div>
    );
  }

  return (
    <>
      <div className="no-print" style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: 10 }}>Your guest QR code</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, margin: "0 0 6px" }}>{eventName}</h1>
          <p style={{ color: "#a8a29a", fontSize: 14, marginBottom: 28 }}>{formatDate(eventInfo.event_date)}</p>

          <div style={{ background: "#F7F3EC", borderRadius: 16, padding: 24, marginBottom: 24, display: "inline-block" }}>
            <img src={qrImageUrl} alt="Guest upload QR code" width={240} height={240} style={{ display: "block" }} />
          </div>

          <p style={{ fontSize: 13, color: "#8a857d", marginBottom: 24, wordBreak: "break-all" }}>{uploadUrl}</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={handleShare} style={primaryBtnStyle}>
              <Share2 size={16} /> Share with guests
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleCopy} style={secondaryBtnStyle}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy link"}
              </button>
              <button onClick={handlePrint} style={secondaryBtnStyle}>
                <Printer size={16} /> Print card
              </button>
            </div>
            <a href={qrImageUrl} download={`recapped-qr-${slug}.png`} style={{ ...secondaryBtnStyle, textDecoration: "none" }}>
              <Download size={16} /> Download QR image
            </a>
          </div>
        </div>
      </div>

      {/* Printable card — hidden on screen, shown only when printing */}
      <div className="print-card">
        <p className="print-eyebrow">You're invited to add to the story</p>
        <h1 className="print-title">{eventName}</h1>
        <p className="print-date">{formatDate(eventInfo.event_date)}</p>
        <img src={qrImageUrl} alt="Guest upload QR code" width={280} height={280} />
        <p className="print-url">{uploadUrl}</p>
        <p className="print-footer">Scan to add your photos &amp; videos — no app needed</p>
      </div>

      <style>{`
        .print-card { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            min-height: 100vh;
            padding: 40px;
            font-family: Georgia, serif;
            color: #211F1D;
            background: #ffffff;
          }
          .print-eyebrow { font-family: 'Inter', system-ui, sans-serif; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #7A8B76; font-weight: 600; margin-bottom: 12px; }
          .print-title { font-size: 32px; margin: 0 0 6px; }
          .print-date { font-family: 'Inter', system-ui, sans-serif; font-size: 14px; color: #555; margin-bottom: 28px; }
          .print-url { font-family: 'Inter', system-ui, sans-serif; font-size: 12px; color: #777; margin-top: 20px; word-break: break-all; }
          .print-footer { font-family: 'Inter', system-ui, sans-serif; font-size: 13px; color: #C97A3D; font-weight: 600; margin-top: 8px; }
        }
      `}</style>
    </>
  );
}

const primaryBtnStyle = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px", borderRadius: 10, border: "none", background: "#C97A3D", color: "#211F1D", fontSize: 15, fontWeight: 700, cursor: "pointer" };
const secondaryBtnStyle = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 10, border: "1px solid #4a4642", background: "transparent", color: "#F7F3EC", fontSize: 14, fontWeight: 600, cursor: "pointer" };

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
