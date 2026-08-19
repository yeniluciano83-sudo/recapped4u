"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Camera, Upload, Check, Image as ImageIcon, Film, Loader2, AlertTriangle } from "lucide-react";

// A dropped connection (weak WiFi/cell signal at a real event, common with
// a room full of phones) fails a request before it ever reaches our
// server -- nothing to log, nothing retryable server-side. Retrying here,
// client-side, is the only place that actually helps. A 4xx response means
// the server looked at the request and rejected it for a reason retrying
// won't fix (uploads closed, event cancelled) -- don't waste attempts on
// those; only retry on network failures or 5xx.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 900;

async function uploadOneFile(endpoint, uploaderName, file) {
  let lastError = "Upload failed. Please try again.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const formData = new FormData();
      formData.append("uploaderName", uploaderName);
      formData.append("files", file);
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };
      lastError = data.error || "Upload failed. Please try again.";
      if (res.status >= 400 && res.status < 500) return { ok: false, error: lastError, retryable: false };
    } catch (err) {
      lastError = "Upload failed. Please try again.";
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
  }
  return { ok: false, error: lastError, retryable: true };
}

export default function EventUploadPage() {
  const params = useParams();
  const eventId = params?.eventId;

  const [files, setFiles] = useState([]);
  const [uploaderName, setUploaderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [uploadError, setUploadError] = useState(null);
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
    setUploadError(null);
    // One request per file -- a single request bundling several real
    // phone photos/videos easily exceeds Vercel's ~4.5MB request body
    // limit and gets rejected with a 413 before our code even runs,
    // failing the *entire* batch even though most files were fine.
    const endpoint = `/api/events/${eventId}/upload`;
    const name = uploaderName || "Guest";
    const stillFailed = [];
    let uploadedCount = 0;
    let stoppedEarly = null;

    for (const file of files) {
      const result = await uploadOneFile(endpoint, name, file);
      if (result.ok) {
        uploadedCount += 1;
      } else if (!result.retryable) {
        // Server rejected the request for a reason retrying won't fix
        // (uploads closed, event cancelled) -- true of every remaining
        // file too, so stop here instead of attempting the rest.
        stoppedEarly = result.error;
        break;
      } else {
        stillFailed.push(file);
      }
    }

    setUploadCount((c) => c + uploadedCount);

    if (stoppedEarly) {
      setUploadError(stoppedEarly);
    } else if (stillFailed.length > 0) {
      setUploadError(
        uploadedCount > 0
          ? `${uploadedCount} of ${files.length} added. ${stillFailed.length} didn't make it after retrying -- check your connection and tap "Add to the recap" again to retry just those.`
          : `Upload failed after retrying. Please check your connection and try again.`
      );
      setFiles(stillFailed); // leave only the failed ones selected for an easy retry
    } else {
      setJustUploaded(true);
      setFiles([]);
      setUploaderName("");
      setTimeout(() => setJustUploaded(false), 3500);
    }

    setUploading(false);
  };

  const notActivated = eventInfo?.status === "pending_confirmation";
  const uploadsClosed = notActivated || eventInfo?.status === "cancelled" || Boolean(eventInfo?.uploads_closed_at);

  const reelSegments = Math.min(uploadCount, 24);
  const eventName = eventInfo?.host_name ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "This event";
  const eventDate = eventInfo?.event_date || "";

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 64px" }}>
      <div style={{ width: "100%", height: "10px", display: "flex", gap: "3px", padding: "0 12px", background: "#F0EAE0" }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: "10px", borderRadius: "1px", background: i < reelSegments ? "#C97A3D" : "#E4DED2", transition: "background 0.4s ease" }} />
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "480px", padding: "40px 24px 0" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", marginBottom: "10px", fontWeight: 600 }}>You're invited to add to the story</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "34px", lineHeight: 1.15, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: "15px", color: "#4a4642", margin: 0 }}>{eventDate}</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px", fontSize: "14px", color: "#7A8B76" }}>
          <strong style={{ color: "#C97A3D", fontSize: "16px" }}>{uploadCount}</strong> {uploadCount === 1 ? "moment" : "moments"} captured so far
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "28px 22px", border: "1px solid #E4DED2" }}>
          {uploadsClosed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "16px 8px", textAlign: "center" }}>
              <AlertTriangle size={24} color="#C97A3D" />
              <p style={{ fontSize: "14px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
                {notActivated
                  ? "This event hasn't been activated yet."
                  : eventInfo.status === "cancelled"
                  ? "This event has been cancelled and is no longer accepting uploads."
                  : "The host has closed uploads for this event — the recap is already being put together."}
              </p>
            </div>
          ) : (
            <>
              <label htmlFor="name-input" style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px" }}>Your name (so we know who to thank)</label>
              <input id="name-input" type="text" value={uploaderName} onChange={(e) => setUploaderName(e.target.value)} placeholder="e.g. Jordan"
                style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", marginBottom: "20px", boxSizing: "border-box" }} />

              <label htmlFor="file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "32px 16px", borderRadius: "12px", border: "1.5px dashed #C9BFA9", cursor: "pointer", textAlign: "center" }}>
                <Camera size={28} color="#C97A3D" strokeWidth={1.6} />
                <span style={{ fontSize: "15px", fontWeight: 500 }}>{files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} ready` : "Tap to add photos or video"}</span>
                <span style={{ fontSize: "13px", color: "#6b655c" }}>Straight from your camera roll</span>
                <input id="file-input" type="file" accept="image/*,video/*" multiple onChange={handleFiles} style={{ display: "none" }} />
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
          Your photos help build the event recap video.<br />No account needed — just this link.
        </p>
        <p style={{ textAlign: "center", marginTop: "18px" }}>
          <a href="/#about" style={{ fontSize: "13px", color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>
            Learn more about us →
          </a>
        </p>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </main>
  );
}
