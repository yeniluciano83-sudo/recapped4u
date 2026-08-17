"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Camera, Upload, Check, Image as ImageIcon, Film, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";

// The host's own upload page -- same full-page treatment as the guest page
// at /event/[eventId], but reached only from the host's QR/management page
// (/qr/[slug]), never shared with guests.
export default function HostUploadPage() {
  const params = useParams();
  const slug = params?.slug;

  const [files, setFiles] = useState([]);
  const [uploaderName, setUploaderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [eventInfo, setEventInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadEventInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}`);
      const data = await res.json();
      setEventInfo(data.event || null);
      setUploadCount(data.uploadCount || 0);
      setUploaderName((prev) => prev || data.event?.host_name || "");
    } catch (err) {
      console.error("Failed to load event info", err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (slug) loadEventInfo(); }, [slug, loadEventInfo]);

  const handleFiles = (e) => setFiles(Array.from(e.target.files || []));

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("uploaderName", uploaderName || eventInfo?.host_name || "Host");
      files.forEach((f) => formData.append("files", f));

      const res = await fetch(`/api/events/${slug}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed. Please try again.");
        return;
      }

      setUploadCount((c) => c + files.length);
      setJustUploaded(true);
      setFiles([]);
      setTimeout(() => setJustUploaded(false), 3500);
    } catch (err) {
      console.error("Upload failed", err);
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        Loading…
      </main>
    );
  }

  if (!eventInfo) {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        Event not found.
      </main>
    );
  }

  const uploadsClosed = eventInfo.status === "cancelled" || Boolean(eventInfo.uploads_closed_at);
  const reelSegments = Math.min(uploadCount, 24);
  const eventName = eventInfo.host_name ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "This event";

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 64px" }}>
      <div style={{ width: "100%", height: "10px", display: "flex", gap: "3px", padding: "0 12px", background: "#F0EAE0" }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: "10px", borderRadius: "1px", background: i < reelSegments ? "#C97A3D" : "#E4DED2", transition: "background 0.4s ease" }} />
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "480px", padding: "40px 24px 0" }}>
        <a href={`/qr/${slug}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#7A8B76", fontWeight: 600, textDecoration: "none", marginBottom: 24 }}>
          <ArrowLeft size={14} /> Back to your QR code
        </a>

        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", marginBottom: "10px", fontWeight: 600 }}>Your own upload page</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "34px", lineHeight: 1.15, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: "15px", color: "#4a4642", margin: 0 }}>Add photos and video straight from your own camera roll</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px", fontSize: "14px", color: "#7A8B76" }}>
          <strong style={{ color: "#C97A3D", fontSize: "16px" }}>{uploadCount}</strong> {uploadCount === 1 ? "moment" : "moments"} captured so far
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "28px 22px", border: "1px solid #E4DED2" }}>
          {uploadsClosed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "16px 8px", textAlign: "center" }}>
              <AlertTriangle size={24} color="#C97A3D" />
              <p style={{ fontSize: "14px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
                {eventInfo.status === "cancelled"
                  ? "This event has been cancelled and is no longer accepting uploads."
                  : "Uploads are closed for this event — the recap is already being put together."}
              </p>
            </div>
          ) : (
            <>
              <label htmlFor="host-name-input" style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px" }}>Your name</label>
              <input id="host-name-input" type="text" value={uploaderName} onChange={(e) => setUploaderName(e.target.value)} placeholder={eventInfo.host_name || "Your name"}
                style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", marginBottom: "20px", boxSizing: "border-box" }} />

              <label htmlFor="host-file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "32px 16px", borderRadius: "12px", border: "1.5px dashed #C9BFA9", cursor: "pointer", textAlign: "center" }}>
                <Camera size={28} color="#C97A3D" strokeWidth={1.6} />
                <span style={{ fontSize: "15px", fontWeight: 500 }}>{files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} ready` : "Tap to add photos or video"}</span>
                <span style={{ fontSize: "13px", color: "#6b655c" }}>Straight from your camera roll</span>
                <input id="host-file-input" type="file" accept="image/*,video/*" multiple onChange={handleFiles} style={{ display: "none" }} />
              </label>

              {files.length > 0 && (
                <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {files.slice(0, 6).map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", background: "#FAF7F2", padding: "5px 9px", borderRadius: "999px", color: "#4a4642" }}>
                      {f.type.startsWith("video") ? <Film size={12} /> : <ImageIcon size={12} />}
                      {f.name.length > 14 ? f.name.slice(0, 12) + "…" : f.name}
                    </div>
                  ))}
                  {files.length > 6 && <div style={{ fontSize: "12px", color: "#6b655c", padding: "5px 4px" }}>+{files.length - 6} more</div>}
                </div>
              )}

              <button onClick={handleUpload} disabled={files.length === 0 || uploading}
                role="status" aria-live="polite"
                style={{ width: "100%", marginTop: "20px", padding: "14px", borderRadius: "10px", border: "none", background: files.length === 0 ? "#E4DED2" : "#C97A3D", color: files.length === 0 ? "#8a857d" : "#211F1D", fontSize: "15px", fontWeight: 700, cursor: files.length === 0 || uploading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                {uploading ? <><Loader2 size={17} className="spin" /> Adding to the reel…</> : justUploaded ? <><Check size={17} /> Added — thank you!</> : <><Upload size={17} /> Add to the recap</>}
              </button>

              {uploadError && (
                <p role="alert" style={{ fontSize: "12.5px", color: "#C97A3D", marginTop: "12px", textAlign: "center" }}>{uploadError}</p>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: "12px", color: "#8a857d", marginTop: "22px", lineHeight: 1.6 }}>
          This page is just for you — it's not the link your guests use.<br />Share your QR code or guest link separately.
        </p>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </main>
  );
}
