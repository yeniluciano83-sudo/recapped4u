"use client";
import React, { useState, useEffect, useCallback, useRef, useId } from "react";
import { fieldStyle, toastStyle } from "@/components/ui";
import { Calendar, Clock, CheckCircle2, Circle, Search, ChevronRight, Inbox, Flame, AlertTriangle, Plus, Copy, Check, X } from "lucide-react";
import { useModalDialog } from "@/lib/useModalDialog";

const STATUS_FLOW = ["booked", "collecting", "analyzing", "editing", "delivered"];
// Two statuses fall outside the linear happy-path flow above -- pipeline
// pauses awaiting the host's Roast Reel approval, and host-cancelled --
// so they're not in STATUS_FLOW (nothing to click through), but still need
// a real label/color instead of falling back to the raw DB string.
const STATUS_LABEL = { booked: "Booked", collecting: "Collecting uploads", analyzing: "Analyzing photos", editing: "Editing", delivered: "Delivered", awaiting_roast_approval: "Awaiting Roast Reel approval", pending_confirmation: "Awaiting email confirmation", cancelled: "Cancelled" };
const STATUS_COLOR = { booked: "#7A8B76", collecting: "#C97A3D", analyzing: "#C97A3D", editing: "#C97A3D", delivered: "#7A8B76", awaiting_roast_approval: "#C97A3D", pending_confirmation: "#8a857d", cancelled: "#8a857d" };
const TIER_LABEL = { free: "Free", standard: "Highlight", premium: "Spotlight", keepsake: "Luxe" };
// Free is already $0 -- nothing to quote a custom price against.
const QUOTABLE_TIERS = ["standard", "premium", "keepsake"];
const EMPTY_QUOTE_FORM = { hostName: "", email: "", eventType: "", eventDate: "", eventEndDate: "", guestCount: "", tier: "standard", amount: "", label: "", description: "", notes: "", roastEnabled: false, roastLevel: "light" };
const ROAST_LABEL = { light: "Light Roasting", lukewarm: "Lukewarm Roasting", hot: "Hot Roasting" };
// Keep in sync with GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const GALLERY_RETENTION = { standard: "2 months", premium: "4 months", keepsake: "6 months" };
// Keep in sync with STALE_EDITING_HOURS/STALE_ANALYZING_HOURS in
// scripts/poll-and-recap.js -- a booking stuck at "editing" (or "analyzing",
// which can legitimately last hours waiting on a Claude batch, hence the
// much longer threshold) past these was almost certainly killed mid-run
// (job timeout, OOM) rather than genuinely still processing, and the
// scheduler will auto-recover it on its next tick. Surfaced here too so a
// stuck booking isn't invisible between scheduler runs.
const STALE_EDITING_HOURS = 1.5;
const STALE_ANALYZING_HOURS = 12;
function isStale(b) {
  if (!b.processing_started_at) return false;
  const elapsedMs = Date.now() - new Date(b.processing_started_at).getTime();
  if (b.status === "editing") return elapsedMs > STALE_EDITING_HOURS * 3600000;
  if (b.status === "analyzing") return elapsedMs > STALE_ANALYZING_HOURS * 3600000;
  return false;
}

export default function Dashboard() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const [analysisFailures, setAnalysisFailures] = useState([]);
  const [analysisFailuresLoading, setAnalysisFailuresLoading] = useState(false);

  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState(EMPTY_QUOTE_FORM);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [quoteResult, setQuoteResult] = useState(null); // { checkoutUrl } once created
  const [quoteLinkCopied, setQuoteLinkCopied] = useState(false);
  const quoteModalRef = useRef(null);
  const quoteModalTitleId = useId();

  useEffect(() => {
    if (!selected) {
      setAnalysisFailures([]);
      return;
    }
    let cancelled = false;
    setAnalysisFailuresLoading(true);
    fetch(`/api/bookings/${selected.id}/analysis-failures`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setAnalysisFailures(data.failures || []); })
      .catch((err) => console.error("Failed to load analysis failures", err))
      .finally(() => { if (!cancelled) setAnalysisFailuresLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const closeQuoteForm = () => {
    setShowQuoteForm(false);
    setQuoteForm(EMPTY_QUOTE_FORM);
    setQuoteError(null);
    setQuoteResult(null);
    setQuoteLinkCopied(false);
  };

  // Called unconditionally (isActive tracks showQuoteForm) rather than
  // extracted into its own only-mounted-while-open component -- this modal's
  // form has enough controlled state and handlers that prop-drilling all of
  // it into a new component risked missing one, versus the small dialogs
  // elsewhere on this page that were cheap to extract cleanly.
  useModalDialog(quoteModalRef, closeQuoteForm, showQuoteForm);

  const submitQuote = async () => {
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      const res = await fetch("/api/admin/custom-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create quote");
      setQuoteResult({ checkoutUrl: data.checkoutUrl });
      load();
    } catch (err) {
      setQuoteError(err.message || "Failed to create quote");
    } finally {
      setQuoteSubmitting(false);
    }
  };

  const copyQuoteLink = async () => {
    if (!quoteResult?.checkoutUrl) return;
    try {
      await navigator.clipboard.writeText(quoteResult.checkoutUrl);
      setQuoteLinkCopied(true);
      setTimeout(() => setQuoteLinkCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy quote link", err);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bookings");
      const data = await res.json();
      setBookings(data.bookings || []);
    } catch (err) {
      console.error("Failed to load bookings", err);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Status can be changed from several places (the list, the detail panel),
  // so a toast rather than an inline message pinned to one of them -- same
  // reasoning as app/qr/[slug]/page.jsx's toast. See toastStyle in
  // components/ui.jsx.
  const [toast, setToast] = useState(null);
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const updateStatus = async (id, newStatus) => {
    const prevBookings = bookings;
    const prevSelected = selected;
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b)));
    if (selected?.id === id) setSelected((s) => ({ ...s, status: newStatus }));
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    } catch (err) {
      // Without this, a failed save (network blip, expired session) left
      // the optimistic update on screen with no indication it never
      // actually persisted -- a reload would silently revert it.
      console.error("Failed to save status change", err);
      setBookings(prevBookings);
      setSelected(prevSelected);
      showToast("Failed to save the status change. Please try again.");
    }
  };

  const filtered = bookings
    .filter((b) => (filter === "all" ? true : b.status === filter))
    .filter((b) => (b.host_name || "").toLowerCase().includes(query.toLowerCase()) || (b.event_type || "").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const counts = STATUS_FLOW.reduce((acc, s) => { acc[s] = bookings.filter((b) => b.status === s).length; return acc; }, {});

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div {...(selected ? { inert: true } : {})} style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 20px 60px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "28px" }}>
          <div>
            <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 6px" }}>Recapped For You</p>
            <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(24px, 3.2vw, 30px)", margin: 0 }}>Your events</h1>
          </div>
          <button onClick={() => setShowQuoteForm(true)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", borderRadius: "10px", border: "1px solid #C97A3D", background: "#FBEEE0", color: "#C97A3D", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            <Plus size={15} /> Custom quote
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px", marginBottom: "24px" }}>
          {STATUS_FLOW.map((s) => (
            <button key={s} onClick={() => setFilter(filter === s ? "all" : s)} aria-pressed={filter === s} style={{ textAlign: "left", padding: "14px", borderRadius: "12px", cursor: "pointer", background: filter === s ? "#FBEEE0" : "#FFFFFF", border: filter === s ? "1.5px solid #C97A3D" : "1px solid #E4DED2" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: STATUS_COLOR[s] }}>{counts[s] || 0}</div>
              <div style={{ fontSize: "12px", color: "#4a4642", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
                {filter === s && <CheckCircle2 size={12} color="#C97A3D" />} {STATUS_LABEL[s]}
              </div>
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: "20px" }}>
          <Search size={16} color="#8a857d" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by host or event type" style={{ width: "100%", padding: "12px 14px 12px 40px", borderRadius: "10px", border: "1px solid #E4DED2", background: "#FFFFFF", color: "#211F1D", fontSize: "14px", boxSizing: "border-box" }} />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#8a857d" }}>Loading events…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#8a857d" }}>
            <Inbox size={28} style={{ marginBottom: "10px", opacity: 0.6 }} />
            <div>No events match here yet.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filtered.map((b) => (
              <button key={b.id} onClick={() => setSelected(b)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: "12px", background: "#FFFFFF", border: "1px solid #E4DED2", cursor: "pointer", textAlign: "left" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
                    {b.host_name}
                    {b.roast_enabled && <Flame size={13} color="#C97A3D" title="Roast Reel add-on" />}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6b655c", marginTop: "3px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Calendar size={12} /> {formatDate(b.event_date)}</span>
                    <span>{b.event_type}</span>
                    <span>{TIER_LABEL[b.tier] || b.tier}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {isStale(b) && (
                    <span title={`Stuck at "Editing" for over ${STALE_EDITING_HOURS}h -- likely killed mid-run. The scheduler will auto-recover it on its next tick.`}
                      style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, padding: "5px 10px", borderRadius: "999px", background: "#FBE9E7", color: "#B3402A", border: "1px solid #B3402A44" }}>
                      <AlertTriangle size={12} /> Stuck
                    </span>
                  )}
                  <span style={{ fontSize: "12px", padding: "5px 10px", borderRadius: "999px", background: "#FAF7F2", color: STATUS_COLOR[b.status], border: `1px solid ${STATUS_COLOR[b.status]}44` }}>{STATUS_LABEL[b.status] || b.status}</span>
                  <ChevronRight size={16} color="#8a857d" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <DetailPanel booking={selected} analysisFailures={analysisFailures} onUpdateStatus={updateStatus} onClose={() => setSelected(null)} />
      )}

      {showQuoteForm && (
        <div onClick={closeQuoteForm} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }}>
          <div ref={quoteModalRef} role="dialog" aria-modal="true" aria-labelledby={quoteModalTitleId} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "440px", maxHeight: "90vh", overflowY: "auto", background: "#FFFFFF", borderRadius: "16px", padding: "26px 24px", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
              <h2 id={quoteModalTitleId} style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(19px, 2.1vw, 23px)", margin: 0 }}>Custom quote</h2>
              <button onClick={closeQuoteForm} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#8a857d", padding: "4px" }}><X size={18} /></button>
            </div>

            {quoteResult ? (
              <div>
                <p style={{ fontSize: 15, color: "#4a4642", lineHeight: 1.6, margin: "0 0 14px" }}>
                  Booking created. Send this checkout link to the host — they'll pay and their event goes live automatically.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input readOnly value={quoteResult.checkoutUrl} onFocus={(e) => e.target.select()}
                    style={{ flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid #D8CFC0", fontSize: "12.5px", color: "#211F1D", background: "#FAF7F2" }} />
                  <button onClick={copyQuoteLink} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "10px 14px", borderRadius: "8px", border: "none", background: "#C97A3D", color: "#211F1D", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {quoteLinkCopied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                  </button>
                </div>
                <button onClick={closeQuoteForm} style={{ marginTop: "18px", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #E4DED2", background: "#FFFFFF", color: "#211F1D", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Done</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <FormField label="Host name">
                  <input value={quoteForm.hostName} onChange={(e) => setQuoteForm((f) => ({ ...f, hostName: e.target.value }))} style={inputStyle} />
                </FormField>
                <FormField label="Email">
                  <input type="email" value={quoteForm.email} onChange={(e) => setQuoteForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
                </FormField>
                <div style={{ display: "flex", gap: "10px" }}>
                  <FormField label="Event type" style={{ flex: 1 }}>
                    <input value={quoteForm.eventType} onChange={(e) => setQuoteForm((f) => ({ ...f, eventType: e.target.value }))} placeholder="e.g. Corporate" style={inputStyle} />
                  </FormField>
                  <FormField label="Event date" style={{ flex: 1 }}>
                    <input type="date" value={quoteForm.eventDate} onChange={(e) => setQuoteForm((f) => ({ ...f, eventDate: e.target.value }))} style={inputStyle} />
                  </FormField>
                </div>
                <FormField label="End date (optional, for multi-day events)">
                  <input type="date" value={quoteForm.eventEndDate} onChange={(e) => setQuoteForm((f) => ({ ...f, eventEndDate: e.target.value }))} style={inputStyle} />
                </FormField>
                <div style={{ display: "flex", gap: "10px" }}>
                  <FormField label="Base tier" style={{ flex: 1 }}>
                    <select value={quoteForm.tier} onChange={(e) => setQuoteForm((f) => ({ ...f, tier: e.target.value }))} style={inputStyle}>
                      {QUOTABLE_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Guests (optional)" style={{ flex: 1 }}>
                    <input type="number" min="0" value={quoteForm.guestCount} onChange={(e) => setQuoteForm((f) => ({ ...f, guestCount: e.target.value }))} style={inputStyle} />
                  </FormField>
                </div>
                <p style={{ fontSize: "12px", color: "#8a857d", margin: "-6px 0 0" }}>Base tier drives upload limits, gallery retention, and Roast Reel eligibility — it doesn't set the price.</p>

                <FormField label="Custom price (USD)">
                  <input type="number" min="0" step="0.01" value={quoteForm.amount} onChange={(e) => setQuoteForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 125" style={inputStyle} />
                </FormField>
                <FormField label="Line item label (optional)">
                  <input value={quoteForm.label} onChange={(e) => setQuoteForm((f) => ({ ...f, label: e.target.value }))} placeholder="Recapped For You — Custom Quote" style={inputStyle} />
                </FormField>
                <FormField label="Description shown at checkout (optional)">
                  <textarea value={quoteForm.description} onChange={(e) => setQuoteForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="What's included -- e.g. 2-day coverage, priority delivery" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                </FormField>

                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
                  <input type="checkbox" checked={quoteForm.roastEnabled} onChange={(e) => setQuoteForm((f) => ({ ...f, roastEnabled: e.target.checked }))} />
                  Include Roast Reel
                </label>
                {quoteForm.roastEnabled && quoteForm.tier === "premium" && (
                  <FormField label="Roast level">
                    <select value={quoteForm.roastLevel} onChange={(e) => setQuoteForm((f) => ({ ...f, roastLevel: e.target.value }))} style={inputStyle}>
                      <option value="light">Light (free)</option>
                      <option value="lukewarm">Lukewarm (+$20)</option>
                      <option value="hot">Hot (+$20)</option>
                    </select>
                  </FormField>
                )}

                <FormField label="Special request notes (optional)">
                  <textarea value={quoteForm.notes} onChange={(e) => setQuoteForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Host's specific asks -- staff-facing, not shown to the host" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                </FormField>

                {quoteError && <p role="alert" style={{ fontSize: 15, color: "#B3402A", margin: 0 }}>{quoteError}</p>}

                <button onClick={submitQuote} disabled={quoteSubmitting} style={{ marginTop: "6px", width: "100%", padding: "13px", borderRadius: "10px", border: "none", background: "#C97A3D", color: "#211F1D", fontSize: "14px", fontWeight: 700, cursor: quoteSubmitting ? "default" : "pointer", opacity: quoteSubmitting ? 0.7 : 1 }}>
                  {quoteSubmitting ? "Creating…" : "Create quote link"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <p role="alert" style={toastStyle()}>{toast}</p>}
    </main>
  );
}

const inputStyle = fieldStyle({ size: "md" });

function DetailPanel({ booking, analysisFailures, onUpdateStatus, onClose }) {
  const containerRef = useRef(null);
  const titleId = useId();
  useModalDialog(containerRef, onClose);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", height: "100%", background: "#FFFFFF", borderLeft: "1px solid #E4DED2", padding: "28px 22px", overflowY: "auto", boxSizing: "border-box" }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8a857d", fontSize: "13px", cursor: "pointer", marginBottom: "18px", padding: 0 }}>← Back to list</button>
        <h2 id={titleId} style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(19px, 2.1vw, 23px)", margin: "0 0 4px" }}>{booking.host_name}</h2>
        <p style={{ color: "#6b655c", fontSize: 15, margin: "0 0 22px" }}>
          {booking.event_type} · {formatDate(booking.event_date)}{booking.event_end_date ? ` – ${formatDate(booking.event_end_date)}` : ""}
        </p>

        <DetailRow label="Package" value={TIER_LABEL[booking.tier] || booking.tier} />
        {booking.custom_price_cents != null && (
          <DetailRow label="Custom price" value={`$${(booking.custom_price_cents / 100).toFixed(2)}`} />
        )}
        {booking.upload_slug && (
          <div style={{ padding: "10px 0", borderBottom: "1px solid #E4DED2" }}>
            <a href={`/qr/${booking.upload_slug}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: "13px", color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>
              View / Share / Print Guest QR Code →
            </a>
          </div>
        )}
        {booking.status === "delivered" && (
          <div style={{ padding: "10px 0", borderBottom: "1px solid #E4DED2" }}>
            <a href={`/gallery/${booking.id}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: "13px", color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>
              View delivered gallery &amp; recap →
            </a>
          </div>
        )}
        <DetailRow label="Style" value={booking.style} />
        {booking.email && <DetailRow label="Email" value={booking.email} />}
        {booking.guest_count && <DetailRow label="Guests" value={booking.guest_count} />}
        {booking.roast_enabled && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #E4DED2", fontSize: "14px" }}>
            <span style={{ color: "#6b655c", display: "flex", alignItems: "center", gap: "5px" }}><Flame size={13} color="#C97A3D" /> Roast Reel</span>
            <span style={{ fontWeight: 500, color: "#C97A3D" }}>{ROAST_LABEL[booking.roast_level] || booking.roast_level}</span>
          </div>
        )}
        {booking.notes && <DetailRow label="Notes" value={booking.notes} />}

        {analysisFailures.length > 0 && (
          <div style={{ marginTop: "16px", padding: "12px 14px", background: "#FBE9E7", border: "1px solid #B3402A44", borderRadius: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#B3402A", marginBottom: "6px" }}>
              <AlertTriangle size={13} /> {analysisFailures.length} photo{analysisFailures.length > 1 ? "s" : ""} failed analysis and {analysisFailures.length > 1 ? "were" : "was"} excluded
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {analysisFailures.map((f) => (
                <div key={f.id} style={{ fontSize: "12px", color: "#6b655c", lineHeight: 1.5 }}>
                  <span style={{ fontFamily: "monospace" }}>{f.storage_key.split("/").pop()}</span> — {f.error_message}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "24px" }}>
          <div style={{ fontSize: "12px", color: "#4a4642", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
          {isStale(booking) && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 12px", borderRadius: "10px", background: "#FBE9E7", border: "1px solid #B3402A44", marginBottom: "10px", fontSize: "13px", color: "#B3402A", fontWeight: 600 }}>
              <AlertTriangle size={14} /> Stuck at "{STATUS_LABEL[booking.status]}" for over {booking.status === "analyzing" ? STALE_ANALYZING_HOURS : STALE_EDITING_HOURS}h -- the scheduler will auto-recover it on its next run.
            </div>
          )}
          {!STATUS_FLOW.includes(booking.status) && (
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#FBEEE0", border: `1px solid ${STATUS_COLOR[booking.status] || "#D8CFC0"}`, marginBottom: "10px", fontSize: "14px", color: STATUS_COLOR[booking.status] || "#211F1D", fontWeight: 600 }}>
              {STATUS_LABEL[booking.status] || booking.status}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", opacity: STATUS_FLOW.includes(booking.status) ? 1 : 0.5 }}>
            {STATUS_FLOW.map((s) => {
              const active = s === booking.status;
              const inFlow = STATUS_FLOW.includes(booking.status);
              const done = inFlow && STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(booking.status);
              return (
                <button key={s} disabled={!inFlow} onClick={() => onUpdateStatus(booking.id, s)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: inFlow ? "pointer" : "default", textAlign: "left", background: active ? "#FBEEE0" : "transparent", border: active ? "1px solid #C97A3D" : "1px solid transparent" }}>
                  {done || active ? <CheckCircle2 size={16} color={active ? "#C97A3D" : "#7A8B76"} /> : <Circle size={16} color="#D8CFC0" />}
                  <span style={{ fontSize: "14px", color: active ? "#211F1D" : "#4a4642" }}>{STATUS_LABEL[s]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: "18px", padding: "14px", background: "#FFFFFF", border: "1px solid #E4DED2", borderRadius: "10px", fontSize: "12px", color: "#6b655c", lineHeight: 1.6 }}>
          <Clock size={12} style={{ marginRight: "5px", verticalAlign: "-1px" }} />
          Raw uploads auto-remove 30 days after delivery. Gallery link stays live{" "}
          {booking.gallery_expires_at
            ? `until ${formatExpiryDate(booking.gallery_expires_at)}`
            : booking.tier === "free"
            ? "for 7 days, then it's permanently removed"
            : `for ${GALLERY_RETENTION[booking.tier] || "90 days"} after delivery`}.
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ fontSize: "12.5px", color: "#4a4642", display: "block", marginBottom: "5px" }}>{label}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #E4DED2", fontSize: "14px" }}><span style={{ color: "#6b655c" }}>{label}</span><span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span></div>;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

// For full ISO timestamps (e.g. gallery_expires_at) -- unlike event_date,
// these already include a time/offset, so appending "T00:00:00" the way
// formatDate does would corrupt the string instead of parsing it.
function formatExpiryDate(dateStr) {
  try { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
