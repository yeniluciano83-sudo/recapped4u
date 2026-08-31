"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Camera, Upload, Check, Loader2, AlertTriangle, Sparkles } from "lucide-react";

// How often to re-check status while it's still moving -- lets a host who
// leaves this tab open see "processing" flip to "ready" on its own, instead
// of needing to know to reload. Stopped once status is delivered/cancelled
// (see the effect below), so this never polls forever.
const STATUS_POLL_MS = 60000;

// A dropped connection (weak WiFi/cell signal at a real event, common with
// a room full of phones) fails a request before it ever reaches our
// server -- nothing to log, nothing retryable server-side. Retrying here,
// client-side, is the only place that actually helps. A 4xx response means
// the server looked at the request and rejected it for a reason retrying
// won't fix (uploads closed, event cancelled) -- don't waste attempts on
// those; only retry on network failures or 5xx.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 900;

// Stable across every retry of the SAME File object -- the browser never
// changes a file's name/size/lastModified between attempts, whether the
// retry is this function's own loop or the guest re-tapping the upload
// button with the same still-selected file. Lets the server recognize a
// repeat and skip re-inserting it (see app/api/events/[eventId]/upload
// /route.js) instead of creating a duplicate row when a request actually
// succeeded but its response got lost -- confirmed live at a real event,
// not just a theoretical race.
function clientUploadIdFor(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

async function uploadOneFile(endpoint, uploaderName, file) {
  let lastError = "Upload failed. Please try again.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const formData = new FormData();
      formData.append("uploaderName", uploaderName);
      formData.append("files", file);
      formData.append("clientUploadId", clientUploadIdFor(file));
      const res = await fetch(endpoint, { method: "POST", body: formData });
      // Vercel itself rejects an oversized request body with a 413 before
      // our route ever runs (see MAX_FILE_SIZE_BYTES's comment in
      // app/api/events/[eventId]/upload/route.js) -- one large phone photo
      // alone can trip this, not just a big batch. That response never
      // goes through our NextResponse.json() calls, so it has no
      // {error, scope} shape to read -- detect it by status instead so it
      // gets scoped to just this file like our own oversized check does.
      if (res.status === 413) {
        return { ok: false, error: "This photo is too large to upload. Try a smaller version.", retryable: false, scope: "file" };
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };
      lastError = data.error || "Upload failed. Please try again.";
      if (res.status >= 400 && res.status < 500) return { ok: false, error: lastError, retryable: false, scope: data.scope };
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
  const [thumbnails, setThumbnails] = useState([]);
  const [uploaderName, setUploaderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [justUploaded, setJustUploaded] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [eventInfo, setEventInfo] = useState(null);
  const [staleBuild, setStaleBuild] = useState(false);

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

  // A guest at a real event often leaves this tab open for the whole
  // party, uploading in bursts as they take photos -- if a fix deploys
  // in the meantime, their tab keeps running the JS it loaded at the
  // start, silently missing it (this is exactly what happened with a
  // real batch-upload bug: retrying in the same stale tab kept hitting
  // the old, already-fixed behavior). Comparing the live server's
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
    if (eventId) { loadEventInfo(); checkBuildFreshness(); }
  }, [eventId, loadEventInfo, checkBuildFreshness]);

  // Only poll while status can still change -- delivered/cancelled are
  // terminal, and re-fetching an active upload session (files selected,
  // an in-flight upload) risks stomping local state for no reason.
  const status = eventInfo?.status;
  useEffect(() => {
    if (!eventId || !status || status === "delivered" || status === "cancelled") return;
    const interval = setInterval(() => { loadEventInfo(); checkBuildFreshness(); }, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [eventId, status, loadEventInfo, checkBuildFreshness]);

  // Real thumbnails, not just filenames -- a guest recognizes their own
  // photo on sight, not by "IMG_2594.HEIC". Regenerated whenever `files`
  // changes, including the post-upload narrowing down to just the file(s)
  // that still need a retry, so what's shown always matches what's selected.
  // Revoking on every change (not just unmount) keeps this from leaking a
  // blob URL per photo over a guest uploading many batches in one session.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setThumbnails(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  const handleFiles = (e) => setFiles(Array.from(e.target.files || []));

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    // One request per file -- a single request bundling several real
    // phone photos easily exceeds Vercel's ~4.5MB request body limit and
    // gets rejected with a 413 before our code even runs, failing the
    // *entire* batch even though most files were fine.
    const endpoint = `/api/events/${eventId}/upload`;
    const name = uploaderName || "Guest";
    const stillFailed = [];   // network/5xx -- worth an automatic retry via re-tap
    const rejected = [];      // this one photo was rejected (wrong type / too large) -- retrying it won't help, doesn't say anything about the rest of the batch
    let uploadedCount = 0;
    let stoppedEarly = null;
    let stoppedAtIndex = -1;

    for (let i = 0; i < files.length; i++) {
      const result = await uploadOneFile(endpoint, name, files[i]);
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

    // Best-effort telemetry, not part of the guest's flow -- a photo that
    // failed even after every retry means something's actually wrong
    // (an R2/Supabase blip, a bad deploy), unlike a per-file rejection or
    // an expected booking-state stop. Lets that reach Sentry the moment it
    // happens instead of only surfacing once someone notices a booking
    // stalled at a low photo count.
    if (stillFailed.length > 0) {
      fetch(`/api/events/${eventId}/upload-batch-issue`, {
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
      // keeping selected.
      setFiles((prev) => prev.slice(stoppedAtIndex + 1));
    } else if (stillFailed.length > 0 || rejected.length > 0) {
      setUploadError(
        (uploadedCount > 0
          ? `${uploadedCount} of ${files.length} added.`
          : stillFailed.length > 0 ? `Upload failed after retrying.` : `Upload failed.`
        ) + rejectedMsg +
        (stillFailed.length > 0 ? ` ${stillFailed.length} didn't make it after retrying -- check your connection and tap "Add to the recap" again to retry just those.` : "")
      );
      setFiles(stillFailed); // rejected files are dropped for good; only the network-failed ones stay selected for an easy retry
    } else {
      setJustUploaded(true);
      setFiles([]);
      setUploaderName("");
      setTimeout(() => setJustUploaded(false), 3500);
    }

    setUploading(false);
  };

  const notActivated = status === "pending_confirmation";
  const isCancelled = status === "cancelled";
  const isProcessing = status === "analyzing" || status === "editing";
  const isDelivered = status === "delivered";
  const uploadsClosed = notActivated || isCancelled || isProcessing || isDelivered || Boolean(eventInfo?.uploads_closed_at);

  const reelSegments = Math.min(uploadCount, 24);
  const eventName = eventInfo?.host_name ? `${eventInfo.host_name}'s ${eventInfo.event_type}` : "This event";
  const eventDate = formatDate(eventInfo?.event_date);
  // Matches the turnaround promise already made on the homepage FAQ ("How
  // long does it take?") -- kept in sync manually since that's plain JSX
  // text, not a shared constant.
  const turnaroundText = eventInfo?.tier === "keepsake"
    ? "Luxe recaps are usually ready within 24 hours (priority turnaround)."
    : "Recaps are usually ready within a few days.";

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 64px" }}>
      {/* justUploaded (already tracked for the button's "Added -- thank
          you!" state) doubles as the trigger window for both this glow and
          the counter bump below -- a guest's contribution visibly landing,
          not just a silent count update. */}
      <div className={justUploaded ? "reel-glow" : undefined} style={{ width: "100%", height: "10px", display: "flex", gap: "3px", padding: "0 12px", background: "#F0EAE0" }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className={i < reelSegments ? "reel-segment-filled" : undefined} style={{ flex: 1, height: "10px", borderRadius: "1px", background: i < reelSegments ? "#C97A3D" : "#E4DED2", transition: "background 0.4s ease" }} />
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: "480px", padding: "40px 24px 0" }}>
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", marginBottom: "10px", fontWeight: 600 }}>You're invited to add to the story</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "34px", lineHeight: 1.15, margin: "0 0 8px" }}>{eventName}</h1>
          <p style={{ fontSize: "15px", color: "#4a4642", margin: 0 }}>{eventDate}</p>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px", fontSize: "14px", color: "#7A8B76" }}>
          <strong className={justUploaded ? "count-pop" : undefined} style={{ color: "#C97A3D", fontSize: "16px", display: "inline-block" }}>{uploadCount}</strong> {uploadCount === 1 ? "moment" : "moments"} captured so far
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "28px 22px", border: "1px solid #E4DED2" }}>
          {isDelivered ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px 8px", textAlign: "center" }}>
              <Check size={26} color="#7A8B76" className="success-pop" />
              <p style={{ fontSize: "16px", fontWeight: 700, color: "#211F1D", margin: 0 }}>Your recap is ready!</p>
              <p style={{ fontSize: "14px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
                The video and photo gallery have been delivered to the host's inbox.
              </p>
              <a href={`/gallery/${eventInfo.id}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "6px", padding: "12px 22px", borderRadius: "10px", background: "#C97A3D", color: "#211F1D", fontSize: "14px", fontWeight: 700, textDecoration: "none" }}>
                View the recap →
              </a>
            </div>
          ) : isProcessing ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "16px 8px", textAlign: "center" }}>
              <Sparkles size={24} color="#C97A3D" className="pulse" />
              <p style={{ fontSize: "16px", fontWeight: 700, color: "#211F1D", margin: 0 }}>Your recap is being made right now!</p>
              <p style={{ fontSize: "14px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>{turnaroundText}</p>
            </div>
          ) : uploadsClosed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "16px 8px", textAlign: "center" }}>
              <AlertTriangle size={24} color="#C97A3D" />
              <p style={{ fontSize: "14px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
                {notActivated
                  ? "This event hasn't been activated yet."
                  : isCancelled
                  ? "This event has been cancelled and is no longer accepting uploads."
                  : "Uploads are closed for this event — processing starts soon."}
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
              <label htmlFor="name-input" style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px" }}>Your name (so we know who to thank)</label>
              <input id="name-input" type="text" value={uploaderName} onChange={(e) => setUploaderName(e.target.value)} placeholder="e.g. Jordan"
                style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", marginBottom: "20px", boxSizing: "border-box" }} />

              <label htmlFor="file-input" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "32px 16px", borderRadius: "12px", border: "1.5px dashed #C9BFA9", cursor: "pointer", textAlign: "center" }}>
                <Camera size={28} color="#C97A3D" strokeWidth={1.6} />
                <span style={{ fontSize: "15px", fontWeight: 500 }}>{files.length > 0 ? `${files.length} photo${files.length > 1 ? "s" : ""} ready` : "Tap to add photos"}</span>
                <span style={{ fontSize: "13px", color: "#6b655c" }}>Straight from your camera roll</span>
                <input id="file-input" type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
              </label>

              {files.length > 0 && (
                <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {/* Actual photos, not filenames -- after a partial upload
                      failure this list narrows down to just what still
                      needs a retry, and a guest recognizes their own photo
                      on sight far faster than "IMG_2594.HEIC". */}
                  {files.slice(0, 6).map((f, i) => (
                    <img key={i} src={thumbnails[i]} alt={f.name} title={f.name}
                      style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", border: "1px solid #E4DED2", display: "block" }} />
                  ))}
                  {files.length > 6 && <div style={{ fontSize: "12px", color: "#6b655c", padding: "5px 4px", alignSelf: "center" }}>+{files.length - 6} more</div>}
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
          Your photos help build the event recap video — the host can star favorites to guarantee they make the cut.<br />No account needed — just this link.
        </p>
        <p style={{ textAlign: "center", marginTop: "18px" }}>
          <a href="/#about" style={{ fontSize: "13px", color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>
            Learn more about us →
          </a>
        </p>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .pulse { animation: pulse 1.8s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        .success-pop { animation: success-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes success-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        .count-pop { animation: count-pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes count-pop-in { 0% { transform: scale(1); } 45% { transform: scale(1.35); } 100% { transform: scale(1); } }
        .reel-glow .reel-segment-filled { animation: reel-segment-glow 0.7s ease-out; }
        @keyframes reel-segment-glow {
          0% { box-shadow: 0 0 0 rgba(201,122,61,0); }
          35% { box-shadow: 0 0 6px 1px rgba(201,122,61,0.85); }
          100% { box-shadow: 0 0 0 rgba(201,122,61,0); }
        }
        @media (prefers-reduced-motion: reduce) { .success-pop, .pulse, .count-pop, .reel-glow .reel-segment-filled { animation: none; } }
      `}</style>
    </main>
  );
}
