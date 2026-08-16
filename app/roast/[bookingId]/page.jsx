"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Flame, Check, Loader2 } from "lucide-react";

export default function RoastApprovalPage() {
  const params = useParams();
  const bookingId = params?.bookingId;

  const [data, setData] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/roast/${bookingId}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Failed to load Roast Reel script");
        return;
      }
      setData(d);
      setLines(d.lines);
      if (d.status === "approved") setApproved(true);
    } catch (err) {
      console.error("Failed to load roast script", err);
      setError("Failed to load Roast Reel script");
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { if (bookingId) load(); }, [bookingId, load]);

  const updateLine = (i, text) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, line: text } : l)));
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/roast/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: lines.map(({ photo_index, storage_key, line }) => ({ photo_index, storage_key, line })) }),
      });
      if (!res.ok) throw new Error("Approval failed");
      setApproved(true);
    } catch (err) {
      console.error("Approval failed", err);
      alert("Something went wrong approving the script. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={shellStyle}>
        <p style={{ color: "#a8a29a" }}>Loading your Roast Reel script…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={shellStyle}>
        <p style={{ color: "#a8a29a" }}>{error}</p>
      </div>
    );
  }

  const eventName = `${data.booking.host_name}'s ${data.booking.event_type}`;

  if (approved) {
    return (
      <div style={shellStyle}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Check size={28} color="#211F1D" strokeWidth={2.5} />
          </div>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: "0 0 10px" }}>Script approved</h1>
          <p style={{ color: "#a8a29a", fontSize: 14.5, lineHeight: 1.6 }}>
            Thanks, {data.booking.host_name.split(" ")[0]}. We'll finish producing your video with this Roast Reel script and let you know when it's ready.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px 100px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#C97A3D", fontWeight: 600, margin: "0 0 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Flame size={13} /> Roast Reel script review
          </p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: 14, color: "#a8a29a", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            Nothing gets shared with your guests until you approve this. Edit any line below, then approve when it's ready.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ background: "#2a2723", borderRadius: 14, border: "1px solid #3a3733", overflow: "hidden", display: "flex", gap: 14, padding: 14 }}>
              <img src={l.photo_url} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: "#8a857d", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Photo {l.photo_index + 1}</label>
                <textarea
                  value={l.line}
                  onChange={(e) => updateLine(i, e.target.value)}
                  style={{ width: "100%", minHeight: 60, padding: "10px 12px", borderRadius: 8, border: "1px solid #4a4642", background: "#211F1D", color: "#F7F3EC", fontSize: 14, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ))}
        </div>

        <button onClick={handleApprove} disabled={submitting}
          style={{ width: "100%", marginTop: 28, padding: 16, borderRadius: 10, border: "none", background: submitting ? "#4a4642" : "#C97A3D", color: submitting ? "#8a857d" : "#211F1D", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: submitting ? "default" : "pointer" }}>
          {submitting ? <><Loader2 size={17} className="spin" /> Approving…</> : <><Check size={17} /> Approve this script</>}
        </button>
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}

const shellStyle = { minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
