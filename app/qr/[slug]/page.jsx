"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { buttonStyle, shadow, radius, LoadingState, toastStyle } from "@/components/ui";
import { useParams, useSearchParams } from "next/navigation";
import { Download, Share2, Printer, Copy, Check, CheckCircle2, Star, AlertTriangle, Clock, Camera, ChevronRight, Play, Pause, Trash2 } from "lucide-react";
import { getUploadLimit } from "@/lib/uploadLimits";

// Spotlight/Luxe only, matching what those tiers actually advertise.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
// Matches the guest upload page's own film-reel filmstrip (app/event/[eventId]/page.jsx)
// -- same 24-segment visual language, but a different meaning behind it. The
// guest's version fills toward 24 raw uploads, a momentum cue with no cap
// context a guest doesn't need. This one fills toward the tier's actual
// upload limit (lib/uploadLimits.js), which is exactly the number this
// page's DELETE-photo and close-uploads controls, and the
// upload-cap-reached email, all exist to manage.
const HOST_REEL_SEGMENTS = 24;
const STYLES = [
  { id: "cinematic", label: "Cinematic" },
  { id: "upbeat", label: "Upbeat" },
  { id: "documentary", label: "Documentary" },
  { id: "retro", label: "Nostalgic / Retro" },
  { id: "highlight", label: "Highlight Reel" },
];
// "none" skips the social cut's music entirely, distinct from leaving it
// unset (which falls back to matching the main video's style/music).
const SOCIAL_STYLE_OPTIONS = [...STYLES, { id: "none", label: "No theme (no music)" }];

// Mirrors the STYLE_MUSIC map in scripts/auto-recap.js -- same files, served
// from public/ so they're directly playable here for a style preview.
const MUSIC_PREVIEW_URL = {
  cinematic: "/music/cinematic.mp3",
  upbeat: "/music/upbeat.mp3",
  documentary: "/music/documentary.mp3",
  retro: "/music/retro.mp3",
  highlight: "/music/highlight.mp3",
};

function StylePreviewButton({ styleId, playingId, onToggle }) {
  const url = MUSIC_PREVIEW_URL[styleId];
  if (!url) return null;
  const isPlaying = playingId === styleId;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(styleId); }}
      aria-label={isPlaying ? `Pause ${styleId} soundtrack preview` : `Preview ${styleId} soundtrack`}
      style={{
        position: "absolute", top: "50%", right: "8px", transform: "translateY(-50%)",
        width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid #D8CFC0", background: isPlaying ? "#C97A3D" : "#FFFFFF",
        color: isPlaying ? "#FFFFFF" : "#4a4642",
      }}>
      {isPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" style={{ marginLeft: "1px" }} />}
    </button>
  );
}

export default function QrSharePage() {
  const params = useParams();
  const slug = params?.slug;
  // This is the host's own management page, reached from the emailed link.
  // The slug in the URL is a guest credential (it's what the QR encodes), so
  // every host-only call below carries this token instead. See lib/hostToken.js.
  const hostToken = useSearchParams().get("t") || "";

  const [eventInfo, setEventInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [closingUploads, setClosingUploads] = useState(false);
  const [extendingDeadline, setExtendingDeadline] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // One shared toast for delete-photo, close-uploads, and extend-deadline --
  // three separate buttons scattered across this page, any of which can
  // fail. Pinning an error under just one would be misleading if a
  // different action was the one that actually failed. See toastStyle in
  // components/ui.jsx.
  const [toast, setToast] = useState(null);
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  // One shared <audio> element for every style preview button on this page --
  // starting a new preview stops whatever was already playing.
  const previewAudioRef = useRef(null);
  const [previewingStyle, setPreviewingStyle] = useState(null);
  const togglePreview = (styleId) => {
    const audio = previewAudioRef.current || (previewAudioRef.current = new Audio());
    if (previewingStyle === styleId) {
      audio.pause();
      setPreviewingStyle(null);
      return;
    }
    audio.src = MUSIC_PREVIEW_URL[styleId];
    audio.currentTime = 0;
    audio.play().catch(() => {});
    audio.onended = () => setPreviewingStyle(null);
    setPreviewingStyle(styleId);
  };

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

  // Tier alone isn't enough -- Spotlight/Luxe can still opt into "video_only"
  // delivery (booking.delivery_format), and the pipeline honors that by
  // skipping social cuts entirely regardless of tier (see finalizeDelivery's
  // own delivery_format !== "video_only" gate in scripts/auto-recap.js).
  // Showing this section anyway would let a video_only host pick a social
  // cut theme and star photos for a cut that will never render.
  const isSocialCutEligible =
    eventInfo && SOCIAL_CUT_ELIGIBLE_TIERS.includes(eventInfo.tier) && eventInfo.delivery_format !== "video_only";

  useEffect(() => {
    if (!slug || eventInfo?.status !== "collecting") return;
    setPhotosLoading(true);
    fetch(`/api/events/${slug}/uploads?t=${encodeURIComponent(hostToken)}`)
      .then((res) => res.json())
      .then((data) => setPhotos(data.photos || []))
      .catch((err) => console.error("Failed to load photos", err))
      .finally(() => setPhotosLoading(false));
  }, [slug, hostToken, eventInfo?.status]);

  const qrImageUrl = slug ? `/api/qrcode/${slug}` : "";
  const uploadUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/event/${slug}` : "";
  const eventName = eventInfo ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "";

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: eventName, text: `Add your photos to ${eventName}`, url: uploadUrl });
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
      await fetch(`/api/events/${slug}?t=${encodeURIComponent(hostToken)}`, {
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

  const handleToggleMustIncludeSocial = async (photo) => {
    const next = !photo.mustIncludeSocial;
    setTogglingId(photo.id);
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, mustIncludeSocial: next } : p)));
    try {
      await fetch(`/api/events/${slug}/uploads/${photo.id}?t=${encodeURIComponent(hostToken)}`, {
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

  const handleToggleMustInclude = async (photo) => {
    const next = !photo.mustInclude;
    setTogglingId(photo.id);
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, mustInclude: next } : p)));
    try {
      await fetch(`/api/events/${slug}/uploads/${photo.id}?t=${encodeURIComponent(hostToken)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mustInclude: next }),
      });
    } catch (err) {
      console.error("Failed to update photo", err);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, mustInclude: !next } : p))); // revert on failure
    } finally {
      setTogglingId(null);
    }
  };

  // Pairs with sendUploadCapReachedEmail (lib/email.js) -- that email points
  // hosts back to this page specifically so they can do this: free up room
  // against their tier's cap without waiting on a WhatsApp message to us.
  const handleDeletePhoto = async (photo) => {
    if (!window.confirm("Remove this photo? It won't be recovered, and the guest who uploaded it would need to add it again.")) return;
    setDeletingId(photo.id);
    const previous = photos;
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id)); // optimistic -- rolled back on failure below
    try {
      const res = await fetch(`/api/events/${slug}/uploads/${photo.id}?t=${encodeURIComponent(hostToken)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to remove photo. Please try again.");
        setPhotos(previous);
      }
    } catch (err) {
      console.error("Failed to delete photo", err);
      showToast("Failed to remove photo. Please try again.");
      setPhotos(previous);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCloseUploads = async () => {
    if (!window.confirm("Once you close uploads, anything guests add after this point won't make it into the recap, and processing will begin within a few hours (not instantly). Continue?")) {
      return;
    }
    setClosingUploads(true);
    try {
      const res = await fetch(`/api/events/${slug}/close-uploads?t=${encodeURIComponent(hostToken)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to close uploads. Please try again.");
        return;
      }
      setEventInfo((prev) => ({ ...prev, uploads_closed_at: data.uploadsClosedAt }));
    } catch (err) {
      console.error("Failed to close uploads", err);
      showToast("Failed to close uploads. Please try again.");
    } finally {
      setClosingUploads(false);
    }
  };

  const handleExtendDeadline = async () => {
    if (!window.confirm("This pushes your upload deadline out by 2 days. You can only do this once. Continue?")) {
      return;
    }
    setExtendingDeadline(true);
    try {
      const res = await fetch(`/api/events/${slug}/extend-deadline?t=${encodeURIComponent(hostToken)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to extend deadline. Please try again.");
        return;
      }
      setEventInfo((prev) => ({ ...prev, deadline_extension_hours: data.deadlineExtensionHours }));
    } catch (err) {
      console.error("Failed to extend deadline", err);
      showToast("Failed to extend deadline. Please try again.");
    } finally {
      setExtendingDeadline(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        <LoadingState icon={Camera} label="Loading…" />
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
          <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(21px, 2.6vw, 26px)", margin: "0 0 10px" }}>This event has been cancelled</h1>
          <p style={{ color: "#4a4642", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
            The guest upload link for {eventName} is no longer active. If this wasn't expected, <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: "#C97A3D" }}>message us on WhatsApp</a> and we'll help.
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
          <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(24px, 3.2vw, 30px)", margin: "0 0 6px" }}>{eventName}</h1>
          <p style={{ color: "#4a4642", fontSize: 15, marginBottom: 28 }}>{formatDate(eventInfo.event_date)}</p>

          <div style={{ background: "#FFFFFF", borderRadius: radius.lg, padding: 24, marginBottom: 24, display: "inline-block", border: "1px solid #E4DED2", boxShadow: shadow.md }}>
            <img src={qrImageUrl} alt="Guest upload QR code" width={240} height={240} style={{ display: "block" }} />
          </div>

          <p style={{ fontSize: 15, color: "#6b655c", marginBottom: 24, wordBreak: "break-all" }}>{uploadUrl}</p>

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
            <a href={`/qr/${slug}/upload?t=${encodeURIComponent(hostToken)}`} style={{ marginTop: 24, padding: 18, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left", textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#FBEEE0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Camera size={19} color="#C97A3D" strokeWidth={1.8} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 2px" }}>Add your own photos</p>
                <p style={{ fontSize: 12.5, color: "#6b655c", margin: 0 }}>Your own upload page — straight from your camera roll</p>
              </div>
              <ChevronRight size={18} color="#8a857d" style={{ flexShrink: 0 }} />
            </a>
          )}

          {eventInfo.status === "collecting" && (
            <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              {eventInfo.uploads_closed_at ? (
                <p style={{ fontSize: 15, color: "#7A8B76", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <CheckCircle2 size={16} /> Uploads closed — your recap will start processing within a few hours.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 15, color: "#4a4642", margin: "0 0 10px", lineHeight: 1.5 }}>
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
                <p style={{ fontSize: 15, color: "#7A8B76", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <CheckCircle2 size={16} /> Deadline extended by 2 days.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 15, color: "#4a4642", margin: "0 0 10px", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <Clock size={16} color="#C97A3D" style={{ flexShrink: 0 }} /> Need more time? Luxe includes a one-time 2-day deadline extension.
                  </p>
                  <button onClick={handleExtendDeadline} disabled={extendingDeadline} style={{ ...secondaryBtnStyle, width: "100%" }}>
                    {extendingDeadline ? "Extending…" : "Extend deadline by 2 days"}
                  </button>
                </>
              )}
            </div>
          )}

          {eventInfo.status === "collecting" && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Star your favorites</p>
              <p style={{ fontSize: 12.5, color: "#4a4642", margin: "0 0 12px", lineHeight: 1.5 }}>
                Our AI picks the best shots for your main video automatically, but it can miss a beautiful photo that scores low on technical sharpness. Star any photo that absolutely has to be in the video, regardless of what the AI thinks of it.
              </p>

              {/* Waits on the same photos.length this card's own grid below
                  is already loading -- no extra fetch. Percent-of-cap, not a
                  raw count against a fixed scale: a Free event and a Luxe
                  event are managing completely different numbers (20 vs
                  2000), so the bar has to represent "how full" rather than
                  "how many" to mean the same thing on every tier. */}
              {!photosLoading && eventInfo.tier && (() => {
                const cap = getUploadLimit(eventInfo.tier);
                const uploadCount = photos.length;
                const filled = Math.min(HOST_REEL_SEGMENTS, Math.round((uploadCount / cap) * HOST_REEL_SEGMENTS));
                const atCap = uploadCount >= cap;
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
                      {Array.from({ length: HOST_REEL_SEGMENTS }).map((_, i) => (
                        <div key={i} style={{ flex: 1, height: 8, borderRadius: 1, background: i < filled ? "#C97A3D" : "#E4DED2", transition: "background 0.4s ease" }} />
                      ))}
                    </div>
                    <p style={{ fontSize: 11.5, color: atCap ? "#C97A3D" : "#8a857d", margin: 0, fontWeight: atCap ? 700 : 400 }}>
                      {uploadCount} of {cap} photos uploaded{atCap ? " — event is full, see below to free up room or close uploads" : ""}
                    </p>
                  </div>
                );
              })()}

              {photosLoading ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>Loading photos…</p>
              ) : photos.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>No photos uploaded yet — check back once guests start adding theirs.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {/* A sibling delete button, not part of the star-toggle
                      button itself -- nested <button>s aren't valid HTML,
                      and a host needs to be able to star a photo without
                      also risking deleting it on a mistap. Delete-only here
                      (not duplicated in the social-cut grid below): it's a
                      photo-level action against the shared `photos` list,
                      so removing it here removes it from both grids at once. */}
                  {photos.map((photo) => (
                    <div key={photo.id} style={{ position: "relative", aspectRatio: "1" }}>
                      <button onClick={() => handleToggleMustInclude(photo)} disabled={togglingId === photo.id}
                        style={{
                          position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 8, border: photo.mustInclude ? "2px solid #C97A3D" : "1px solid #E4DED2",
                          padding: 0, cursor: "pointer", overflow: "hidden", backgroundImage: `url(${photo.url})`, backgroundSize: "cover", backgroundPosition: "center",
                        }}>
                        {photo.mustInclude && (
                          <div style={{ position: "absolute", top: 3, right: 3, background: "#C97A3D", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Star size={11} color="#211F1D" fill="#211F1D" />
                          </div>
                        )}
                        {photo.uploaderName && (
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "2px 5px", background: "rgba(33,31,29,0.65)", color: "#FFFFFF", fontSize: 9.5, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {photo.uploaderName}
                          </div>
                        )}
                      </button>
                      <button onClick={() => handleDeletePhoto(photo)} disabled={deletingId === photo.id}
                        aria-label={`Remove photo${photo.uploaderName ? ` from ${photo.uploaderName}` : ""}`}
                        style={{
                          position: "absolute", top: 3, left: 3, background: "rgba(33,31,29,0.65)", border: "none", borderRadius: "50%",
                          width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                          cursor: deletingId === photo.id ? "default" : "pointer", opacity: deletingId === photo.id ? 0.5 : 1,
                        }}>
                        <Trash2 size={10} color="#FFFFFF" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isSocialCutEligible && eventInfo.status === "collecting" && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4DED2", textAlign: "left" }}>
              <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Your social cut</p>
              <p style={{ fontSize: 12.5, color: "#4a4642", margin: "0 0 12px", lineHeight: 1.5 }}>
                Pick a theme for the short cut (defaults to your main style if you don't choose one, or skip its music entirely), and star any photos that absolutely have to be in it.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {SOCIAL_STYLE_OPTIONS.map((s) => (
                  <div key={s.id} style={{ position: "relative", display: "inline-flex" }}>
                    <button onClick={() => handleSetSocialStyle(s.id)} disabled={savingStyle}
                      aria-pressed={eventInfo.social_style === s.id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: MUSIC_PREVIEW_URL[s.id] ? "6px 28px 6px 12px" : "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        border: eventInfo.social_style === s.id ? "1px solid #C97A3D" : "1px solid #D8CFC0",
                        background: eventInfo.social_style === s.id ? "#FBEEE0" : "transparent",
                        color: eventInfo.social_style === s.id ? "#C97A3D" : "#4a4642",
                      }}>
                      {eventInfo.social_style === s.id && <Check size={12} strokeWidth={3} />} {s.label}
                    </button>
                    <StylePreviewButton styleId={s.id} playingId={previewingStyle} onToggle={togglePreview} />
                  </div>
                ))}
              </div>

              {photosLoading ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>Loading photos…</p>
              ) : photos.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "#8a857d", margin: 0 }}>No photos uploaded yet — check back once guests start adding theirs.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {photos.map((photo) => (
                    <button key={photo.id} onClick={() => handleToggleMustIncludeSocial(photo)} disabled={togglingId === photo.id}
                      style={{
                        position: "relative", aspectRatio: "1", borderRadius: 8, border: photo.mustIncludeSocial ? "2px solid #C97A3D" : "1px solid #E4DED2",
                        padding: 0, cursor: "pointer", overflow: "hidden", backgroundImage: `url(${photo.url})`, backgroundSize: "cover", backgroundPosition: "center",
                      }}>
                      {photo.mustIncludeSocial && (
                        <div style={{ position: "absolute", top: 3, right: 3, background: "#C97A3D", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Star size={11} color="#211F1D" fill="#211F1D" />
                        </div>
                      )}
                      {photo.uploaderName && (
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "2px 5px", background: "rgba(33,31,29,0.65)", color: "#FFFFFF", fontSize: 9.5, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {photo.uploaderName}
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

      {toast && <p role="alert" style={toastStyle()}>{toast}</p>}

      {/* Printable card — hidden on screen, shown only when printing */}
      <div className="print-card">
        <p className="print-eyebrow">You're invited to add to the story</p>
        <h1 className="print-title">{eventName}</h1>
        <p className="print-date">{formatDate(eventInfo.event_date)}</p>
        <img src={qrImageUrl} alt="Guest upload QR code" width={280} height={280} />
        <p className="print-url">{uploadUrl}</p>
        <p className="print-footer">Scan to add your photos — no app needed</p>
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
            font-family: var(--font-fraunces), Georgia, serif;
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

// Shared button definitions now live one level up. Padding is overridden
// because these are full-width buttons in a column, where the shared
// horizontal padding would be doing nothing.
const primaryBtnStyle = { ...buttonStyle({ variant: "primary", size: "lg" }), padding: "14px" };
const secondaryBtnStyle = { ...buttonStyle({ variant: "secondary", size: "md" }), flex: 1, padding: "12px" };

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
