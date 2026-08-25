"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Download, Play, Image as ImageIcon, Share2, Clock, X, LayoutGrid, Rows, Film, Square, Check } from "lucide-react";

// Keep in sync with GALLERY_RETENTION in app/booking/page.jsx.
const RETENTION_LABEL = { free: "7-day", standard: "2-month", premium: "4-month", keepsake: "6-month" };

const TEMPLATES = [
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "masonry", label: "Masonry", icon: Rows },
  { id: "slideshow", label: "Slideshow", icon: Film },
  { id: "polaroid", label: "Polaroid", icon: Square },
];

export default function GalleryDeliveryPage() {
  const params = useParams();
  const bookingId = params?.bookingId;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [videoLength, setVideoLength] = useState("full");
  const [template, setTemplate] = useState("grid");
  const [slideIndex, setSlideIndex] = useState(0);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e) => { if (e.key === "Escape") setLightbox(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  useEffect(() => {
    if (!bookingId) return;
    fetch(`/api/gallery/${bookingId}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setTemplate(d?.booking?.gallery_template || "grid");
        // videoLength defaults to "full", but a "social cuts of every
        // photo" delivery (booking.delivery_format === "social_cuts") has
        // no full video at all -- defaulting to it left the page opening
        // on a dead, non-functional state. Fall back to the first social
        // cut whenever there's no full video to default to.
        if (!d?.deliverable?.full_video_url && d?.deliverable?.social_video_urls?.length) {
          setVideoLength("social-0");
        }
      })
      .catch((err) => console.error("Failed to load gallery", err))
      .finally(() => setLoading(false));
  }, [bookingId]);

  const handleShare = async () => {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: eventName, text: `Check out ${eventName}'s recap!`, url: shareUrl });
      } catch (err) {
        // AbortError when the user cancels the native share sheet -- not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch (err) {
      console.error("Failed to copy gallery link", err);
    }
  };

  const triggerStaggeredDownloads = (urls) => {
    if (urls.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    // Triggering every download in the same tick gets most of them silently
    // blocked as a popup flood -- staggering by a beat each lets the browser
    // treat them as separate user-initiated downloads instead.
    urls.forEach((url, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (i === urls.length - 1) setDownloadingAll(false);
      }, i * 300);
    });
  };

  const handleDownloadAll = () => triggerStaggeredDownloads(data?.photo_download_urls || []);

  const handleDownloadSelected = () => {
    const urls = data?.photo_download_urls || [];
    const selectedUrls = Array.from(selectedIndices).sort((a, b) => a - b).map((i) => urls[i]).filter(Boolean);
    triggerStaggeredDownloads(selectedUrls);
    setSelectMode(false);
    setSelectedIndices(new Set());
  };

  const togglePhotoSelected = (index) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handlePhotoClick = (index) => {
    if (selectMode) togglePhotoSelected(index);
    else setLightbox(photos[index]);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIndices(new Set());
  };

  const changeTemplate = async (id) => {
    setTemplate(id);
    setSlideIndex(0);
    setSavingTemplate(true);
    try {
      await fetch(`/api/gallery/${bookingId}/template`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: id }),
      });
    } catch (err) {
      console.error("Failed to save template choice", err);
    } finally {
      setSavingTemplate(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        Loading your recap…
      </main>
    );
  }

  const booking = data?.booking || {};
  const photos = data?.photos || [];
  const eventName = booking.host_name ? `${booking.host_name}'s ${booking.event_type}` : "Your Recap";
  // "full" IS the Roast Reel cut whenever a no-roast twin exists -- that
  // twin only ever gets rendered for roast-enabled bookings (see
  // finalizeDelivery in scripts/auto-recap.js).
  const hasFullCut = Boolean(data?.deliverable?.full_video_url);
  const hasNoRoastCut = Boolean(data?.deliverable?.full_video_no_roast_url);
  const socialUrls = data?.deliverable?.social_video_urls || [];
  const socialDownloadUrls = data?.deliverable?.social_video_download_urls || [];
  const socialNoRoastUrls = data?.deliverable?.social_video_no_roast_urls || [];
  const socialNoRoastDownloadUrls = data?.deliverable?.social_video_no_roast_download_urls || [];
  // "social-N" selects the Nth social cut (Luxe can have several -- see
  // SOCIAL_CUTS_COUNT in scripts/auto-recap.js -- Signature/Free have at
  // most 1, so this collapses to a single "Social cut" toggle for them).
  // A roasted cut's "without roast" twin is "social-N-no_roast" -- parseInt
  // stops at the first non-digit character, so the trailing suffix doesn't
  // break the index extraction below.
  const socialIndex = videoLength.startsWith("social-") ? parseInt(videoLength.slice(7), 10) : -1;
  const isSocialNoRoast = socialIndex >= 0 && videoLength.endsWith("-no_roast");
  const isRoastCut = (videoLength === "full" && hasNoRoastCut) || (socialIndex >= 0 && !isSocialNoRoast && Boolean(socialNoRoastUrls[socialIndex]));
  const activeVideoUrl =
    videoLength === "full" ? data?.deliverable?.full_video_url
    : videoLength === "no_roast" ? data?.deliverable?.full_video_no_roast_url
    : isSocialNoRoast ? socialNoRoastUrls[socialIndex]
    : socialUrls[socialIndex];
  const activeVideoDownloadUrl =
    videoLength === "full" ? data?.deliverable?.full_video_download_url
    : videoLength === "no_roast" ? data?.deliverable?.full_video_no_roast_download_url
    : isSocialNoRoast ? socialNoRoastDownloadUrls[socialIndex]
    : socialDownloadUrls[socialIndex];
  const isExpired = booking.gallery_expires_at && new Date(booking.gallery_expires_at) < new Date();
  const isDownloadOnly = isExpired;

  if (booking.status === "delivered" && !data.deliverable) {
    return (
      <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>Your recap is ready</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "26px", margin: "0 0 10px" }}>{eventName}</h1>
          <p style={{ color: "#4a4642", fontSize: "14.5px", lineHeight: 1.6 }}>
            This gallery's {RETENTION_LABEL[booking.tier] || ""} retention window has ended, and the photos and video have been permanently removed.
            {booking.tier === "free" && " Pick a paid tier next time for a longer downloadable window."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <style>{`
        /* Bigger photo tiles across the board -- 2 columns instead of 3 on
           desktop's 760px-max content column, and a single full-width
           column on phones instead of 2, since that's where the old
           smaller tiles were hardest to make out. */
        .gallery-grid { grid-template-columns: repeat(2, 1fr); }
        .gallery-masonry { column-count: 2; }
        @media (max-width: 480px) {
          .gallery-grid { grid-template-columns: repeat(1, 1fr); }
          .gallery-masonry { column-count: 1; }
        }
      `}</style>
      <div {...(lightbox ? { inert: "" } : {})} style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 12px" }}>Your recap is ready</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "32px", margin: "0 0 8px", lineHeight: 1.15 }}>{eventName}</h1>
          <p style={{ fontSize: "14px", color: "#4a4642", margin: 0 }}>{booking.event_date}</p>
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: "18px", border: "1px solid #E4DED2", overflow: "hidden", marginBottom: "16px" }}>
          <div style={{ aspectRatio: "16/9", background: "linear-gradient(135deg, #FBEEE0, #FAF7F2)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" }}
            onClick={() => { if (activeVideoUrl) window.open(activeVideoUrl, "_blank"); }}>
            {isRoastCut && (
              <span style={{ position: "absolute", top: 14, left: 14, display: "inline-flex", alignItems: "center", gap: 5, background: "#C97A3D", color: "#211F1D", fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999 }}>
                🔥 Roast Reel cut
              </span>
            )}
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Play size={26} color="#211F1D" fill="#211F1D" style={{ marginLeft: "3px" }} />
            </div>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {hasFullCut && <LengthToggle active={videoLength === "full"} onClick={() => setVideoLength("full")} label={hasNoRoastCut ? "Roast Reel cut" : "Full cut"} />}
              {hasFullCut && hasNoRoastCut && <LengthToggle active={videoLength === "no_roast"} onClick={() => setVideoLength("no_roast")} label="Without roast" />}
              {socialUrls.map((_, i) => (
                <React.Fragment key={i}>
                  <LengthToggle active={socialIndex === i && !isSocialNoRoast} onClick={() => setVideoLength(`social-${i}`)} label={socialUrls.length > 1 ? `Social ${i + 1}` : "Social cut"} />
                  {Boolean(socialNoRoastUrls[i]) && (
                    <LengthToggle active={socialIndex === i && isSocialNoRoast} onClick={() => setVideoLength(`social-${i}-no_roast`)} label={socialUrls.length > 1 ? `Social ${i + 1} w/o roast` : "Without roast"} />
                  )}
                </React.Fragment>
              ))}
            </div>
            <a href={activeVideoDownloadUrl} download style={iconBtnStyle}>
              <Download size={16} /> Download
            </a>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "13px", color: "#8a857d", marginBottom: "32px" }}>
          Cut, graded, and paced automatically · {booking.style} style
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <ImageIcon size={18} color="#C97A3D" /> Photo gallery
          </h2>
          {!isDownloadOnly && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => changeTemplate(t.id)}
                    aria-pressed={template === t.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", borderRadius: "999px",
                      fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
                      border: template === t.id ? "1px solid #C97A3D" : "1px solid #E4DED2",
                      background: template === t.id ? "#FBEEE0" : "transparent",
                      color: template === t.id ? "#C97A3D" : "#6b655c",
                    }}>
                    <Icon size={13} /> {t.label} {template === t.id && <Check size={12} strokeWidth={3} />}
                  </button>
                );
              })}
              <button onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
                style={{
                  display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", borderRadius: "999px",
                  fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
                  border: selectMode ? "1px solid #C97A3D" : "1px solid #E4DED2",
                  background: selectMode ? "#FBEEE0" : "transparent",
                  color: selectMode ? "#C97A3D" : "#6b655c",
                }}>
                {selectMode ? "Cancel" : "Select photos"}
              </button>
            </div>
          )}
        </div>
        {savingTemplate && <p style={{ fontSize: "11.5px", color: "#8a857d", marginTop: "-8px", marginBottom: "14px" }}>Saving your layout choice…</p>}

        {isDownloadOnly ? (
          <div style={{ marginBottom: "36px" }}>
            <p style={{ fontSize: "12.5px", color: "#4a4642", margin: "0 0 14px", lineHeight: 1.6 }}>
              Your {RETENTION_LABEL[booking.tier] || ""} window has ended and this gallery is being permanently removed — download anything you'd like to keep right away.
            </p>
            <DownloadOnlyLayout photos={photos} downloadUrls={data?.photo_download_urls || []} />
          </div>
        ) : (
          <div style={{ marginBottom: "36px" }}>
            {template === "grid" && <GridLayout photos={photos} selectMode={selectMode} selected={selectedIndices} onSelect={handlePhotoClick} />}
            {template === "masonry" && <MasonryLayout photos={photos} selectMode={selectMode} selected={selectedIndices} onSelect={handlePhotoClick} />}
            {template === "slideshow" && <SlideshowLayout photos={photos} index={slideIndex} setIndex={setSlideIndex} selectMode={selectMode} selected={selectedIndices} onSelect={handlePhotoClick} />}
            {template === "polaroid" && <PolaroidLayout photos={photos} selectMode={selectMode} selected={selectedIndices} onSelect={handlePhotoClick} />}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            {selectMode ? (
              <>
                <button onClick={handleDownloadSelected} disabled={downloadingAll || selectedIndices.size === 0}
                  style={{ flex: 1, padding: "14px", borderRadius: "10px", border: "none", background: downloadingAll || selectedIndices.size === 0 ? "#E4DED2" : "#C97A3D", color: downloadingAll || selectedIndices.size === 0 ? "#8a857d" : "#211F1D", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", cursor: downloadingAll || selectedIndices.size === 0 ? "default" : "pointer" }}>
                  <Download size={16} /> {downloadingAll ? "Downloading…" : `Download selected (${selectedIndices.size})`}
                </button>
                <button onClick={exitSelectMode} style={{ padding: "14px 18px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "transparent", color: "#211F1D", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={handleShare} style={{ flex: 1, padding: "14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "transparent", color: "#211F1D", fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", cursor: "pointer" }}>
                  {shareCopied ? <><Check size={16} /> Link copied</> : <><Share2 size={16} /> Share this gallery</>}
                </button>
                <button onClick={handleDownloadAll} disabled={downloadingAll || photos.length === 0} style={{ flex: 1, padding: "14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "transparent", color: "#211F1D", fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", cursor: downloadingAll || photos.length === 0 ? "default" : "pointer", opacity: downloadingAll || photos.length === 0 ? 0.6 : 1 }}>
                  <Download size={16} /> {downloadingAll ? "Downloading…" : "Download all"}
                </button>
              </>
            )}
          </div>
          <div style={{ padding: "14px 16px", background: "#FFFFFF", borderRadius: "10px", border: "1px solid #E4DED2", display: "flex", gap: "10px" }}>
            <Clock size={16} color="#C97A3D" style={{ flexShrink: 0, marginTop: "1px" }} />
            <p style={{ fontSize: "12.5px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
              {isDownloadOnly
                ? `Your ${RETENTION_LABEL[booking.tier] || ""} window has ended and this gallery is now being permanently removed.`
                : booking.gallery_expires_at
                ? `This gallery and video stay available until ${formatExpiryDate(booking.gallery_expires_at)}.`
                : "This gallery and video stay available for a limited time."}{" "}
              Please download everything you'd like to keep — raw guest uploads are automatically removed 30 days after delivery.
            </p>
          </div>
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50, overflowY: "auto", padding: "24px" }}>
          {/* Close button is position:fixed (not absolute) so it stays
              pinned to the viewport corner instead of scrolling away with
              the enlarged photo when that photo is taller than the
              screen. */}
          <button onClick={() => setLightbox(null)} aria-label="Close photo" style={{ position: "fixed", top: 20, right: 20, background: "none", border: "none", color: "#FFFFFF", cursor: "pointer", zIndex: 51 }}><X size={26} /></button>
          {/* min-height: 100% + centered flex is the standard pattern for
              a lightbox that centers short content but still lets you
              scroll to see the full image when it doesn't fit the
              viewport -- a plain flex-center with no overflow handling
              (the old version) just clips whatever doesn't fit, with no
              way to reach the clipped part. Applies to every gallery
              template (Grid, Masonry, Polaroid, Slideshow) since they all
              open this same lightbox. */}
          <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={lightbox} alt="" style={{ width: "min(500px, 90vw)", borderRadius: "14px", display: "block" }} />
          </div>
        </div>
      )}
    </main>
  );
}

// The badge shown on a photo when selectMode is on -- a filled check when
// selected, an empty ring otherwise, matching the "must include" star badge
// pattern already used on the QR share page's photo picker.
function SelectBadge({ selected }) {
  return (
    <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: selected ? "#C97A3D" : "rgba(255,255,255,0.85)", border: selected ? "none" : "1.5px solid #D8CFC0", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {selected && <Check size={13} color="#211F1D" strokeWidth={3} />}
    </div>
  );
}

function GridLayout({ photos, selectMode, selected, onSelect }) {
  return (
    <div className="gallery-grid" style={{ display: "grid", gap: "8px" }}>
      {photos.map((url, i) => (
        <button key={i} onClick={() => onSelect(i)} style={{ position: "relative", aspectRatio: "1", borderRadius: "8px", border: selected?.has(i) ? "2px solid #C97A3D" : "2px solid transparent", cursor: "pointer", backgroundColor: "#FFFFFF", backgroundImage: `url(${url})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }}>
          {selectMode && <SelectBadge selected={selected?.has(i)} />}
        </button>
      ))}
    </div>
  );
}

function MasonryLayout({ photos, selectMode, selected, onSelect }) {
  return (
    <div className="gallery-masonry" style={{ columnGap: "8px" }}>
      {photos.map((url, i) => (
        <button key={i} onClick={() => onSelect(i)}
          style={{ position: "relative", display: "block", width: "100%", marginBottom: "8px", borderRadius: "8px", border: selected?.has(i) ? "2px solid #C97A3D" : "2px solid transparent", cursor: "pointer", breakInside: "avoid", padding: 0, background: "none" }}>
          <img src={url} alt="" style={{ width: "100%", borderRadius: "6px", display: "block" }} />
          {selectMode && <SelectBadge selected={selected?.has(i)} />}
        </button>
      ))}
    </div>
  );
}

function SlideshowLayout({ photos, index, setIndex, selectMode, selected, onSelect }) {
  if (photos.length === 0) return null;
  const clampedIndex = Math.min(index, photos.length - 1);
  const current = photos[clampedIndex];
  return (
    <div>
      <div style={{ position: "relative", borderRadius: "16px", overflow: "hidden", background: "#FFFFFF", border: "1px solid #E4DED2" }}>
        <img src={current} alt="" onClick={() => onSelect(clampedIndex)} style={{ width: "100%", aspectRatio: "4/3", objectFit: "contain", display: "block", cursor: "pointer" }} />
        <button onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>‹</button>
        <button onClick={() => setIndex((i) => (i + 1) % photos.length)}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>›</button>
        {selectMode && (
          <button onClick={() => onSelect(clampedIndex)} aria-pressed={selected?.has(clampedIndex)}
            style={{ position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: "50%", background: selected?.has(clampedIndex) ? "#C97A3D" : "rgba(255,255,255,0.9)", border: selected?.has(clampedIndex) ? "none" : "1.5px solid #D8CFC0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            {selected?.has(clampedIndex) && <Check size={16} color="#211F1D" strokeWidth={3} />}
          </button>
        )}
      </div>
      <p style={{ textAlign: "center", fontSize: "12.5px", color: "#6b655c", marginTop: "10px" }}>{index + 1} / {photos.length}</p>
    </div>
  );
}

function DownloadOnlyLayout({ photos, downloadUrls }) {
  return (
    <div className="gallery-grid" style={{ display: "grid", gap: "8px" }}>
      {photos.map((url, i) => (
        <a key={i} href={downloadUrls[i] || url} download style={{ position: "relative", aspectRatio: "1", borderRadius: "8px", overflow: "hidden", display: "block", backgroundColor: "#FFFFFF", backgroundImage: `url(${url})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center", textDecoration: "none" }}>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "6px", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
            <Download size={12} color="#FFFFFF" />
          </div>
        </a>
      ))}
    </div>
  );
}

function PolaroidLayout({ photos, selectMode, selected, onSelect }) {
  const rotations = [-3, 2, -1.5, 3, -2, 1.5];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", justifyContent: "center", padding: "10px 0" }}>
      {photos.map((url, i) => (
        <button key={i} onClick={() => onSelect(i)}
          style={{ position: "relative", background: "#FFFFFF", padding: "10px 10px 24px", borderRadius: "4px", border: selected?.has(i) ? "2px solid #C97A3D" : "2px solid transparent", cursor: "pointer", transform: `rotate(${rotations[i % rotations.length]}deg)`, boxShadow: "0 4px 10px rgba(0,0,0,0.15)", width: "150px" }}>
          <img src={url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", display: "block" }} />
          {selectMode && <SelectBadge selected={selected?.has(i)} />}
        </button>
      ))}
    </div>
  );
}

function formatExpiryDate(dateStr) {
  try { return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

function LengthToggle({ active, onClick, label }) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "7px 13px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", border: active ? "1px solid #C97A3D" : "1px solid #D8CFC0", background: active ? "#FBEEE0" : "transparent", color: active ? "#C97A3D" : "#6b655c" }}>
      {active && <Check size={12} strokeWidth={3} />} {label}
    </button>
  );
}

const iconBtnStyle = { display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px", border: "1px solid #D8CFC0", background: "transparent", color: "#4a4642", fontSize: "13px", cursor: "pointer", textDecoration: "none" };
