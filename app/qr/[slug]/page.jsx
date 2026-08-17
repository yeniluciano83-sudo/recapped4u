"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Download, Share2, Printer, Copy, Check, CheckCircle2, Star, AlertTriangle, Clock, Upload, Camera, Image as ImageIcon, Film, Loader2 } from "lucide-react";

// Signature/Luxe only, matching what those tiers actually advertise.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
const STYLES = [
  { id: "cinematic", label: "Cinematic" },
  { id: "upbeat", label: "Upbeat" },
  { id: "documentary", label: "Documentary" },
  { id: "retro", label: "Nostalgic / Retro" },
  { id: "highlight", label: "Highlight Reel" },
];

export default function QrSharePage() {
  const params = useParams();
  const slug = params?.slug;

  const [eventInfo, setEventInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [closingUploads, setClosingUploads] = useState(false);
  const [extendingDeadline, setExtendingDeadline] = useState(false);
  const [hostFiles, setHostFiles] = useState([]);
  const [hostUploaderName, setHostUploaderName] = useState("");
  const [hostUploading, setHostUploading] = useState(false);
  const [hostJustUploaded, setHostJustUploaded] = useState(false);
  const [hostUploadError, setHostUploadError] = useState(null);
  const [savingStyle, setSavingStyle] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

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

  const isSocialCutEligible = eventInfo && SOCIAL_CUT_ELIGIBLE_TIERS.includes(eventInfo.tier);

  useEffect(() => {
    if (!slug || !isSocialCutEligible || eventInfo?.status !== "collecting") return;
    setPhotosLoading(true);
    fetch(`/api/events/${slug}/uploads`)
      .then((res) => res.json())
      .then((data) => setPhotos(data.photos || []))
      .catch((err) => console.error("Failed to load photos", err))
      .finally(() => setPhotosLoading(false));
  }, [slug, isSocialCutEligible, eventInfo?.status]);

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

  const handleSetSocialStyle = async (styleId) => {
    const next = eventInfo.social_style === styleId ? null : styleId; // click again to clear back to "same as full cut"
    setSavingStyle(true);
    setEventInfo((prev) => ({ ...prev, social_style: next }));
    try {
      await fetch(`/api/events/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialStyle: next }),
      });
    } catch (err) {
      console.error("Failed to save social cut style", err);
    } finally {
      setSavingStyle(false);
    }
  };

  const handleToggleMustInclude = async (photo) => {
    const next = !photo.mustIncludeSocial;
    setTogglingId(photo.id);
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, mustIncludeSocial: next } : p)));
    try {
      await fetch(`/api/events/${slug}/uploads/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mustIncludeSocial: next }),
      });
    } catch (err) {
      console.error("Failed to update photo", err);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, mustIncludeSocial: !next } : p))); // revert on failure
    } finally {
      setTogglingId(null);
    }
  };

  const handleHostFiles = (e) => setHostFiles(Array.from(e.target.files || []));

  const handleHostUpload = async () => {
    if (hostFiles.length === 0) return;
    setHostUploading(true);
    setHostUploadError(null);
    try {
      const formData = new FormData();
      formData.append("uploaderName", hostUploaderName || eventInfo.host_name || "Host");
      hostFiles.forEach((f) => formData.append("files", f));

      const res = await fetch(`/api/events/${slug}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setHostUploadError(data.error || "Upload failed. Please try again.");
        return;
      }

      setHostJustUploaded(true);
      setHostFiles([]);
      setTimeout(() => setHostJustUploaded(false), 3500);
    } catch (err) {
      console.error("Host upload failed", err);
      setHostUploadError("Upload failed. Please try again.");
    } finally {
      setHostUploading(false);
    }
  };

  const handleCloseUploads = async () => {
    if (!window.confirm("Once you close uploads, anything guests add after this point won't make it into the recap, and processing will begin within a few hours (not instantly). Continue?")) {
      return;
    }
    setClosingUploads(true);
    try {
      const res = await fetch(`/api/events/${slug}/close-uploads`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to close uploads. Please try again.");
        return;
      }
      setEventInfo((prev) => ({ ...prev, uploads_closed_at: data.uploadsClosedAt }));
    } catch (err) {
      console.error("Failed to close uploads", err);
      alert("Failed to close uploads. Please try again.");
    } finally {
      setClosingUploads(false);
    }
  };

  const handleExtendDeadline = async () => {
    if (!window.confirm("This pushes your upload deadline out by 2 days, once. Continue?")) {
      return;
    }
    setExtendingDeadline(true);
    try {
      const res = await fetch(`/api/events/${slug}/extend-deadline`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to extend deadline. Please try again.");
        return;
      }
      setEventInfo((prev) => ({ ...prev, deadline_extension_hours: data.deadlineExtensionHours }));
    } catch (err) {
      console.error("Failed to extend deadline", err);
      alert("Failed to extend deadline. Please try again.");
    } finally {
      setExtendingDeadline(false);
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

  if (eventInfo.status === "cancelled") {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-inter), system-ui, sans-serif", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: "0 0 10px" }}>This event has been cancelled</h1>
          <p style={{ color: "#4a4642", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            The guest upload link for {eventName} is no longer active. If this wasn't expected, reply to your booking confirmation email and we'll help.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="no-print" style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 480, textAlign: "center" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: 10 }}>Your guest QR code</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, margin: "0 0 6px" }}>{eventName}</h1>
          <p style={{ color: "#4a4642", fontSize: 14, marginBottom: 28 }}>{formatDate(eventInfo.event_date)}</p>

          <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 24, marginBottom: 24, display: "inline-block", border: "1px solid #E4DED2" }}>
            <img src={qrImageUrl} alt="Guest upload QR code" width={240} height={240} style={{ display: "block" }} />
          </div>

          <p style={{ fontSize: 13, color: "#6b655c", marginBottom: 24, wordBreak: "break-all" }}>{uploadUrl}</p>

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

          {eventInfo.status === "collecting" && !eventInfo.uploads_closed_at && (
            <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 12px" }}>Add your own photos</p>

              <input value={hostUploaderName} onChange={(e) => setHostUploaderName(e.target.value)} placeholder={eventInfo.host_name || "Your name"}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />

              <label htmlFor="host-file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "22px 16px", borderRadius: 12, border: "1.5px dashed #C9BFA9", cursor: "pointer", textAlign: "center" }}>
                <Camera size={22} color="#C97A3D" strokeWidth={1.6} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{hostFiles.length > 0 ? `${hostFiles.length} file${hostFiles.length > 1 ? "s" : ""} ready` : "Tap to add photos or video"}</span>
                <input id="host-file-input" type="file" accept="image/*,video/*" multiple onChange={handleHostFiles} style={{ display: "none" }} />
              </label>

              {hostFiles.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {hostFiles.slice(0, 6).map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: "#FAF7F2", padding: "5px 9px", borderRadius: 999, color: "#4a4642" }}>
                      {f.type.startsWith("video") ? <Film size={12} /> : <ImageIcon size={12} />}
                      {f.name.length > 14 ? f.name.slice(0, 12) + "…" : f.name}
                    </div>
                  ))}
                  {hostFiles.length > 6 && <div style={{ fontSize: 12, color: "#6b655c", padding: "5px 4px" }}>+{hostFiles.length - 6} more</div>}
                </div>
              )}

              <button onClick={handleHostUpload} disabled={hostFiles.length === 0 || hostUploading}
                role="status" aria-live="polite"
                style={{ width: "100%", marginTop: 14, padding: 12, borderRadius: 10, border: "none", background: hostFiles.length === 0 ? "#E4DED2" : "#C97A3D", color: hostFiles.length === 0 ? "#8a857d" : "#211F1D", fontSize: 14, fontWeight: 700, cursor: hostFiles.length === 0 || hostUploading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {hostUploading ? <><Loader2 size={16} className="spin" /> Adding…</> : hostJustUploaded ? <><Check size={16} /> Added — thank you!</> : <><Upload size={16} /> Add to the recap</>}
              </button>

              {hostUploadError && (
                <p role="alert" style={{ fontSize: 12.5, color: "#C97A3D", marginTop: 10, textAlign: "center" }}>{hostUploadError}</p>
              )}
            </div>
          )}

          {eventInfo.status === "collecting" && (
            <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              {eventInfo.uploads_closed_at ? (
                <p style={{ fontSize: 13, color: "#7A8B76", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <CheckCircle2 size={16} /> Uploads closed — your recap will start processing within a few hours.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "#4a4642", margin: "0 0 10px", lineHeight: 1.5 }}>
                    All your guests already uploaded? You don't have to wait for the deadline.
                  </p>
                  <button onClick={handleCloseUploads} disabled={closingUploads} style={{ ...secondaryBtnStyle, width: "100%" }}>
                    {closingUploads ? "Closing…" : "Close uploads & process now"}
                  </button>
                </>
              )}
            </div>
          )}

          {eventInfo.tier === "keepsake" && eventInfo.status === "collecting" && !eventInfo.uploads_closed_at && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              {eventInfo.deadline_extension_hours > 0 ? (
                <p style={{ fontSize: 13, color: "#7A8B76", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <CheckCircle2 size={16} /> Deadline extended by 2 days.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "#4a4642", margin: "0 0 10px", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <Clock size={16} color="#C97A3D" style={{ flexShrink: 0 }} /> Need more time? Luxe includes a one-time 2-day deadline extension.
                  </p>
                  <button onClick={handleExtendDeadline} disabled={extendingDeadline} style={{ ...secondaryBtnStyle, width: "100%" }}>
                    {extendingDeadline ? "Extending…" : "Extend deadline by 2 days"}
                  </button>
                </>
              )}
            </div>
          )}

          {isSocialCutEligible && eventInfo.status === "collecting" && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 4px" }}>Your social cut</p>
              <p style={{ fontSize: 12.5, color: "#4a4642", margin: "0 0 12px", lineHeight: 1.5 }}>
                Pick a theme for the short cut (defaults to your main style if you don't choose one), and star any photos that absolutely have to be in it.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {STYLES.map((s) => (
                  <button key={s.id} onClick={() => handleSetSocialStyle(s.id)} disabled={savingStyle}
                    aria-pressed={eventInfo.social_style === s.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      border: eventInfo.social_style === s.id ? "1px solid #C97A3D" : "1px solid #D8CFC0",
                      background: eventInfo.social_style === s.id ? "#FBEEE0" : "transparent",
                      color: eventInfo.social_style === s.id ? "#C97A3D" : "#4a4642",
                    }}>
                    {eventInfo.social_style === s.id && <Check size={12} strokeWidth={3} />} {s.label}
                  </button>
                ))}
              </div>

              {photosLoading ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>Loading photos…</p>
              ) : photos.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>No photos uploaded yet — check back once guests start adding theirs.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {photos.map((photo) => (
                    <button key={photo.id} onClick={() => handleToggleMustInclude(photo)} disabled={togglingId === photo.id}
                      style={{
                        position: "relative", aspectRatio: "1", borderRadius: 8, border: photo.mustIncludeSocial ? "2px solid #C97A3D" : "1px solid #E4DED2",
                        padding: 0, cursor: "pointer", overflow: "hidden", backgroundImage: `url(${photo.url})`, backgroundSize: "cover", backgroundPosition: "center",
                      }}>
                      {photo.mustIncludeSocial && (
                        <div style={{ position: "absolute", top: 3, right: 3, background: "#C97A3D", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Star size={11} color="#211F1D" fill="#211F1D" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

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
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

const primaryBtnStyle = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px", borderRadius: 10, border: "none", background: "#C97A3D", color: "#211F1D", fontSize: 15, fontWeight: 700, cursor: "pointer" };
const secondaryBtnStyle = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 10, border: "1px solid #D8CFC0", background: "transparent", color: "#211F1D", fontSize: 14, fontWeight: 600, cursor: "pointer" };

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
