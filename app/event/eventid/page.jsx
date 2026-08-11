"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Camera, Upload, Check, Image as ImageIcon, Film, Loader2 } from "lucide-react";

export default function EventUploadPage() {
  const params = useParams();
  const eventId = params?.eventId;

  const [files, setFiles] = useState([]);
  const [uploaderName, setUploaderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [eventInfo, setEventInfo] = useState(null);

  const loadEventInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`);
      const data = await res.json();
      setEventInfo(data.event || null);
      setUploadCount(data.uploadCount || 0);
    } catch (err) {
      console.error("Failed to load event info", err);
    }
  }, [eventId]);

  useEffect(() => { if (eventId) loadEventInfo(); }, [eventId, loadEventInfo]);

  const handleFiles = (e) => setFiles(Array.from(e.target.files || []));

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("uploaderName", uploaderName || "Guest");
      files.forEach((f) => formData.append("files", f));

      await fetch(`/api/events/${eventId}/upload`, { method: "POST", body: formData });

      setUploadCount((c) => c + files.length);
      setJustUploaded(true);
      setFiles([]);
      setUploaderName("");
      setTimeout(() => setJustUploaded(false), 3500);
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setUploading(false);
    }
  };

  const reelSegments = Math.min(uploadCount, 24);
  const eventName = eventInfo?.host_name ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "This event";
  const eventDate = eventInfo?.event_date || "";

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 64px" }}>
      <div style={{ width: "100%", height: "10px", display: "flex", gap: "3px", padding: "0 12px", background: "#1a1815" }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: "10px", borderRadius: "1px", background: i < reelSegments ? "#C97A3D" : "#3a3733", transition: "background 0.4s ease" }} />
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "480px", padding: "40px 24px 0" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", marginBottom: "10px", fontWeight: 600 }}>You're invited to add to the story</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "34px", lineHeight: 1.15, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: "15px", color: "#a8a29a", margin: 0 }}>{eventDate}</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px", fontSize: "14px", color: "#7A8B76" }}>
          <strong style={{ color: "#C97A3D", fontSize: "16px" }}>{uploadCount}</strong> {uploadCount === 1 ? "moment" : "moments"} captured so far
        </div>

        <div style={{ background: "#2a2723", borderRadius: "16px", padding: "28px 22px", border: "1px solid #3a3733" }}>
          <label htmlFor="name-input" style={{ fontSize: "13px", color: "#a8a29a", display: "block", marginBottom: "6px" }}>Your name (so we know who to thank)</label>
          <input id="name-input" type="text" value={uploaderName} onChange={(e) => setUploaderName(e.target.value)} placeholder="e.g. Jordan"
            style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #4a4642", background: "#211F1D", color: "#F7F3EC", fontSize: "15px", marginBottom: "20px", outline: "none", boxSizing: "border-box" }} />

          <label htmlFor="file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "32px 16px", borderRadius: "12px", border: "1.5px dashed #5a564f", cursor: "pointer", textAlign: "center" }}>
            <Camera size={28} color="#C97A3D" strokeWidth={1.6} />
            <span style={{ fontSize: "15px", fontWeight: 500 }}>{files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} ready` : "Tap to add photos or video"}</span>
            <span style={{ fontSize: "13px", color: "#8a857d" }}>Straight from your camera roll</span>
            <input id="file-input" type="file" accept="image/*,video/*" multiple onChange={handleFiles} style={{ display: "none" }} />
          </label>

          {files.length > 0 && (
            <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {files.slice(0, 6).map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", background: "#211F1D", padding: "5px 9px", borderRadius: "999px", color: "#a8a29a" }}>
                  {f.type.startsWith("video") ? <Film size={12} /> : <ImageIcon size={12} />}
                  {f.name.length > 14 ? f.name.slice(0, 12) + "…" : f.name}
                </div>
              ))}
              {files.length > 6 && <div style={{ fontSize: "12px", color: "#8a857d", padding: "5px 4px" }}>+{files.length - 6} more</div>}
            </div>
          )}

          <button onClick={handleUpload} disabled={files.length === 0 || uploading}
            style={{ width: "100%", marginTop: "20px", padding: "14px", borderRadius: "10px", border: "none", background: files.length === 0 ? "#4a4642" : "#C97A3D", color: files.length === 0 ? "#8a857d" : "#211F1D", fontSize: "15px", fontWeight: 700, cursor: files.length === 0 || uploading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {uploading ? <><Loader2 size={17} className="spin" /> Adding to the reel…</> : justUploaded ? <><Check size={17} /> Added — thank you!</> : <><Upload size={17} /> Add to the recap</>}
          </button>
        </div>

        <p style={{ textAlign: "center", fontSize: "12px", color: "#6a655e", marginTop: "22px", lineHeight: 1.6 }}>
          Your photos help build the event recap video.<br />No account needed — just this link.
        </p>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}
