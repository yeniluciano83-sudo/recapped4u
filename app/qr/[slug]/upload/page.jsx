"use client";
import React, { useState, useEffect, useCallback } from "react";
import { shadow, LoadingState } from "@/components/ui";
import { useParams, useSearchParams } from "next/navigation";
import { Camera, Upload, Check, Image as ImageIcon, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";

// A dropped connection (weak WiFi/cell signal at a real event, common with
// a room full of phones) fails a request before it ever reaches our
// server -- nothing to log, nothing retryable server-side. Retrying here,
// client-side, is the only place that actually helps. A 4xx response means
// the server looked at the request and rejected it for a reason retrying
// won't fix (uploads closed, event cancelled) -- don't waste attempts on
// those; only retry on network failures or 5xx.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 900;
// A 429 (rate limited) clears on its own once the sliding window moves --
// wait longer than the normal retry backoff before trying that one file
// again, rather than burning all its attempts against a window that hasn't
// moved yet.
const RATE_LIMIT_RETRY_MS = 3000;

// How often to re-check whether a newer deploy has landed while this tab
// stays open -- see checkBuildFreshness below.
const BUILD_CHECK_MS = 60000;

// Stable across every retry of the SAME File object -- the browser never
// changes a file's name/size/lastModified between attempts, whether the
// retry is this function's own loop or the host re-tapping the upload
// button with the same still-selected file. Lets the server recognize a
// repeat and skip re-inserting it (see app/api/events/[eventId]/upload
// /confirm/route.js) instead of creating a duplicate row when a request
// actually succeeded but its response got lost -- confirmed live at a real
// event, not just a theoretical race.
function clientUploadIdFor(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

// Classifies a JSON error response from our own presign/confirm routes the
// same way regardless of which one it came from: scope: "file" means this
// rejection is about this one photo (skip and continue), anything else
// non-retryable means the whole event stopped accepting uploads (abort the
// rest of the batch). See handleUpload below.
async function classifyJsonError(res) {
  const data = await res.json().catch(() => ({}));
  const error = data.error || "Upload failed. Please try again.";
  // 429: transient, not a permanent rejection -- a room of guests on one
  // shared Wi-Fi (plus a host adding a big album) share a single per-IP
  // budget. Must NOT abort the rest of the batch the way a real 4xx
  // (uploads closed, wrong file type) does; the caller pauses and retries
  // this one file.
  if (res.status === 429) return { rateLimited: true, error };
  if (res.status >= 400 && res.status < 500) return { ok: false, error, retryable: false, scope: data.scope };
  return null; // 5xx -- caller falls through to its retry loop
}

// Uploads go straight from the browser to R2 (see getSignedUploadUrl in
// lib/storage.js) -- our own API routes only ever see small JSON payloads,
// never the actual photo bytes. This is what fixed a real incident: Vercel
// rejects any request body over ~4.5MB with its own 413 before a route
// even runs, so routing raw photo bytes through our function meant one
// large photo alone could fail to upload, no matter how generous our own
// size check claimed to be.
async function uploadOneFile(eventId, uploaderName, file) {
  let lastError = "Upload failed. Please try again.";
  const clientUploadId = clientUploadIdFor(file);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const presignRes = await fetch(`/api/events/${eventId}/upload/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, fileSize: file.size, clientUploadId }),
      });
      if (!presignRes.ok) {
        const classified = await classifyJsonError(presignRes);
        if (classified?.rateLimited) {
          lastError = classified.error;
          if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_MS));
          continue;
        }
        if (classified) return classified;
        lastError = "Upload failed. Please try again.";
      } else {
        const presignData = await presignRes.json().catch(() => ({}));
        if (presignData.alreadyUploaded) {
          return { ok: true };
        }
        const putRes = await fetch(presignData.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (putRes.ok) {
          const confirmRes = await fetch(`/api/events/${eventId}/upload/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: presignData.key, clientUploadId, uploaderName }),
          });
          if (confirmRes.ok) return { ok: true };
          const classified = await classifyJsonError(confirmRes);
          if (classified?.rateLimited) {
            lastError = classified.error;
            if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_MS));
            continue;
          }
          if (classified) return classified;
          lastError = "Upload failed. Please try again.";
        } else {
          lastError = "Upload failed. Please try again.";
        }
      }
    } catch (err) {
      lastError = "Upload failed. Please try again.";
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
  }
  return { ok: false, error: lastError, retryable: true };
}

// The host's own upload page -- same full-page treatment as the guest page
// at /event/[eventId], but reached only from the host's QR/management page
// (/qr/[slug]), never shared with guests.
export default function HostUploadPage() {
  const params = useParams();
  const slug = params?.slug;
  // Carried through purely so the "back" link below returns the host to their
  // management page with its credential intact -- nothing on this page needs
  // it, since adding your own photos uses the same open upload endpoints
  // guests do. See lib/hostToken.js.
  const hostToken = useSearchParams().get("t") || "";

  const [files, setFiles] = useState([]);
  const [uploaderName, setUploaderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [eventInfo, setEventInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [staleBuild, setStaleBuild] = useState(false);

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

  // A host adding their own photos can leave this tab open for a while --
  // if a fix deploys in the meantime, the tab keeps running whatever JS it
  // loaded at the start, silently missing it. Comparing the live server's
  // deploy against the build this tab was loaded with catches that.
  const checkBuildFreshness = useCallback(async () => {
    try {
      const res = await fetch("/api/build-version");
      const data = await res.json();
      if (data.sha && data.sha !== "dev" && data.sha !== process.env.NEXT_PUBLIC_BUILD_SHA) {
        setStaleBuild(true);
      }
    } catch (err) {
      // Best-effort -- never let this block uploads.
    }
  }, []);

  useEffect(() => {
    checkBuildFreshness();
    const interval = setInterval(checkBuildFreshness, BUILD_CHECK_MS);
    return () => clearInterval(interval);
  }, [checkBuildFreshness]);

  // A native <input type="file"> replaces its own selection every time,
  // not adds to it -- picking 5 photos, then tapping "add photos" again to
  // grab 3 more before hitting the upload button, silently dropped the
  // first 5 with no warning. Merges into whatever's already pending
  // instead, deduped by the same identity uploadOneFile's own retry logic
  // already uses, so re-picking a photo already in the queue doesn't queue
  // it twice. Clearing the input's value afterward means picking the exact
  // same file(s) again later still fires a change event -- browsers won't
  // if the selection didn't change from the input's own perspective.
  const handleFiles = (e) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles((prev) => {
      const alreadyPending = new Set(prev.map(clientUploadIdFor));
      return [...prev, ...newFiles.filter((f) => !alreadyPending.has(clientUploadIdFor(f)))];
    });
    e.target.value = "";
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    // One upload sequence (presign -> direct PUT to R2 -> confirm) per
    // file -- see uploadOneFile above.
    const name = uploaderName || eventInfo?.host_name || "Host";
    const stillFailed = [];   // network/5xx -- worth an automatic retry via re-tap
    const rejected = [];      // this one photo was rejected (wrong type / too large) -- retrying it won't help, doesn't say anything about the rest of the batch
    let uploadedCount = 0;
    let stoppedEarly = null;
    let stoppedAtIndex = -1;

    for (let i = 0; i < files.length; i++) {
      const result = await uploadOneFile(slug, name, files[i]);
      if (result.ok) {
        uploadedCount += 1;
      } else if (result.scope === "file") {
        rejected.push(result.error);
      } else if (!result.retryable) {
        // Server rejected the request for a reason retrying won't fix and
        // that's true of every remaining file too (uploads closed, event
        // cancelled, event's recap already started) -- stop here instead
        // of attempting the rest.
        stoppedEarly = result.error;
        stoppedAtIndex = i;
        break;
      } else {
        stillFailed.push(files[i]);
      }
    }

    setUploadCount((c) => c + uploadedCount);

    // Best-effort telemetry, not part of the host's flow -- a photo that
    // failed even after every retry means something's actually wrong
    // (an R2/Supabase blip, a bad deploy), unlike a per-file rejection or
    // an expected booking-state stop. Lets that reach Sentry the moment it
    // happens instead of only surfacing once someone notices a booking
    // stalled at a low photo count.
    if (stillFailed.length > 0) {
      fetch(`/api/events/${slug}/upload-batch-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadedCount, totalCount: files.length, failedCount: stillFailed.length }),
      }).catch(() => {});
    }

    const rejectedMsg = rejected.length === 0 ? "" :
      rejected.length === 1 ? ` 1 photo couldn't be added: ${rejected[0]}` :
      ` ${rejected.length} photos couldn't be added (wrong file type or too large).`;

    if (stoppedEarly) {
      setUploadError(`${stoppedEarly}${rejectedMsg}`);
      // Drop everything up to and including the file that just failed --
      // the ones before it already succeeded (leaving them selected would
      // silently re-upload duplicates on retry), and the one that failed
      // will just fail identically again since the rejection reason won't
      // change. Whatever's left after it is still untried and worth
      // keeping selected -- including anything picked while this batch was
      // still in flight, since handleFiles always appends after it, never
      // splices into it.
      setFiles((prev) => prev.slice(stoppedAtIndex + 1));
    } else if (stillFailed.length > 0 || rejected.length > 0) {
      setUploadError(
        (uploadedCount > 0
          ? `${uploadedCount} of ${files.length} added.`
          : stillFailed.length > 0 ? `Upload failed after retrying.` : `Upload failed.`
        ) + rejectedMsg +
        (stillFailed.length > 0 ? ` ${stillFailed.length} didn't make it after retrying — check your connection and tap Retry to try just those again.` : "")
      );
      // Keep the retryable ones, drop the rejected ones for good, and keep
      // anything picked mid-upload too -- same reasoning as above, it always
      // lands after this batch rather than inside it.
      setFiles((prev) => [...stillFailed, ...prev.slice(files.length)]);
    } else {
      setJustUploaded(true);
      // Only clear the batch this run actually processed -- a fresh pick
      // made while this upload was still in flight lands after it in the
      // array and starts its own run the moment this one flips uploading
      // back off (see the effect below).
      setFiles((prev) => prev.slice(files.length));
      setTimeout(() => setJustUploaded(false), 3500);
    }

    setUploading(false);
  };

  // Auto-send the moment a batch is ready to go -- fires when a fresh pick
  // lands (files grows) or the previous run just finished (uploading flips
  // back to false), so a picked photo never sits waiting on a second tap to
  // actually reach the server. Skipped while uploadError is set: those files
  // already failed once (network issue, or the event itself rejecting
  // uploads) and auto-retrying them forever with no backoff between attempts
  // would just hammer the same failure -- that case waits for the explicit
  // Retry tap below instead.
  useEffect(() => {
    if (files.length > 0 && !uploading && !uploadError) {
      handleUpload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, uploading]);

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

  const uploadsClosed = eventInfo.status === "cancelled" || Boolean(eventInfo.uploads_closed_at);
  const reelSegments = Math.min(uploadCount, 24);
  const eventName = eventInfo.host_name ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "This event";

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 64px" }}>
      {/* justUploaded (already tracked for the button's "Added -- thank
          you!" state) doubles as the trigger window for both this glow and
          the counter bump below -- matches app/event/[eventId]/page.jsx's
          own upload-success treatment, which this page had been missing
          despite having the identical reel bar and counter already. */}
      <div className={justUploaded ? "reel-glow" : undefined} style={{ width: "100%", height: "10px", display: "flex", gap: "3px", padding: "0 12px", background: "#F0EAE0" }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className={i < reelSegments ? "reel-segment-filled" : undefined} style={{ flex: 1, height: "10px", borderRadius: "1px", background: i < reelSegments ? "#C97A3D" : "#E4DED2", transition: "background 0.4s ease" }} />
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "480px", padding: "40px 24px 0" }}>
        <a href={`/qr/${slug}?t=${encodeURIComponent(hostToken)}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#7A8B76", fontWeight: 600, textDecoration: "none", marginBottom: 24 }}>
          <ArrowLeft size={14} /> Back to your QR code
        </a>

        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: 15, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", marginBottom: "10px", fontWeight: 600 }}>Your own upload page</p>
          <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(28px, 4.2vw, 40px)", lineHeight: 1.15, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: "15px", color: "#4a4642", margin: 0 }}>Add photos straight from your own camera roll</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px", fontSize: "14px", color: "#7A8B76" }}>
          <strong className={justUploaded ? "count-pop" : undefined} style={{ color: "#C97A3D", fontSize: "16px", display: "inline-block" }}>{uploadCount}</strong> {uploadCount === 1 ? "moment" : "moments"} captured so far
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "28px 22px", border: "1px solid #E4DED2", boxShadow: shadow.md }}>
          {uploadsClosed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "16px 8px", textAlign: "center" }}>
              <AlertTriangle size={24} color="#C97A3D" />
              <p style={{ fontSize: 15, color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
                {eventInfo.status === "cancelled"
                  ? "This event has been cancelled and is no longer accepting uploads."
                  : "Uploads are closed for this event — the recap is already being put together."}
              </p>
            </div>
          ) : (
            <>
              {staleBuild && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", borderRadius: "10px", background: "#FBEEE0", border: "1px solid #C97A3D", marginBottom: "16px", fontSize: "12.5px", color: "#4a4642" }}>
                  <span>This page has an update available — refresh for the latest fixes.</span>
                  <button onClick={() => window.location.reload()} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: "8px", border: "1px solid #C97A3D", background: "#FFFFFF", color: "#C97A3D", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Refresh</button>
                </div>
              )}
              <label htmlFor="host-name-input" style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px" }}>Your name</label>
              <input id="host-name-input" type="text" value={uploaderName} onChange={(e) => setUploaderName(e.target.value)} placeholder={eventInfo.host_name || "Your name"}
                style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", marginBottom: "20px", boxSizing: "border-box" }} />

              <label htmlFor="host-file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "32px 16px", borderRadius: "12px", border: "1.5px dashed #C9BFA9", cursor: "pointer", textAlign: "center" }}>
                <Camera size={28} color="#C97A3D" strokeWidth={1.6} />
                <span style={{ fontSize: "15px", fontWeight: 500 }}>{files.length > 0 ? `${files.length} photo${files.length > 1 ? "s" : ""} ready` : "Tap to add photos"}</span>
                <span style={{ fontSize: "13px", color: "#6b655c" }}>Straight from your camera roll</span>
                <input id="host-file-input" type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
              </label>

              {files.length > 0 && (
                <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {files.slice(0, 6).map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", background: "#FAF7F2", padding: "5px 9px", borderRadius: "999px", color: "#4a4642" }}>
                      <ImageIcon size={12} />
                      {f.name.length > 14 ? f.name.slice(0, 12) + "…" : f.name}
                    </div>
                  ))}
                  {files.length > 6 && <div style={{ fontSize: "12px", color: "#6b655c", padding: "5px 4px" }}>+{files.length - 6} more</div>}
                </div>
              )}

              {/* Hidden the rest of the time -- picking photos now sends them
                  on its own (see the auto-upload effect above). This only
                  reappears to show progress, confirm success, or offer a
                  manual Retry once something's actually failed. */}
              {(uploading || justUploaded || uploadError) && (
                <button onClick={handleUpload} disabled={files.length === 0 || uploading}
                  role="status" aria-live="polite"
                  style={{ width: "100%", marginTop: "20px", padding: "14px", borderRadius: "10px", border: "none", background: files.length === 0 ? "#E4DED2" : "#C97A3D", color: files.length === 0 ? "#8a857d" : "#211F1D", fontSize: "15px", fontWeight: 700, cursor: files.length === 0 || uploading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  {uploading ? <><Loader2 size={17} className="spin" /> Adding to the recap…</> : justUploaded ? <><Check size={17} /> Added — thank you!</> : <><Upload size={17} /> Retry</>}
                </button>
              )}

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

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .count-pop { animation: count-pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes count-pop-in { 0% { transform: scale(1); } 45% { transform: scale(1.35); } 100% { transform: scale(1); } }
        .reel-glow .reel-segment-filled { animation: reel-segment-glow 0.7s ease-out; }
        @keyframes reel-segment-glow {
          0% { box-shadow: 0 0 0 rgba(201,122,61,0); }
          35% { box-shadow: 0 0 6px 1px rgba(201,122,61,0.85); }
          100% { box-shadow: 0 0 0 rgba(201,122,61,0); }
        }
        @media (prefers-reduced-motion: reduce) { .count-pop, .reel-glow .reel-segment-filled { animation: none; } }
      `}</style>
    </main>
  );
}
