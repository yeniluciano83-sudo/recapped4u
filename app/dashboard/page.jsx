"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, Clock, CheckCircle2, Circle, Search, ChevronRight, Inbox, Flame, Sparkles } from "lucide-react";

const STATUS_FLOW = ["booked", "collecting", "editing", "delivered"];
// Two statuses fall outside the linear happy-path flow above -- pipeline
// pauses awaiting the host's Roast Reel approval, and host-cancelled --
// so they're not in STATUS_FLOW (nothing to click through), but still need
// a real label/color instead of falling back to the raw DB string.
const STATUS_LABEL = { booked: "Booked", collecting: "Collecting uploads", editing: "Editing", delivered: "Delivered", awaiting_roast_approval: "Awaiting Roast Reel approval", pending_confirmation: "Awaiting email confirmation", cancelled: "Cancelled" };
const STATUS_COLOR = { booked: "#7A8B76", collecting: "#C97A3D", editing: "#C97A3D", delivered: "#7A8B76", awaiting_roast_approval: "#C97A3D", pending_confirmation: "#8a857d", cancelled: "#8a857d" };
const TIER_LABEL = { free: "Free", standard: "Classic", premium: "Signature", keepsake: "Luxe" };
const ROAST_LABEL = { light: "Light Roasting", lukewarm: "Lukewarm Roasting", hot: "Hot Roasting" };
// Keep in sync with GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const GALLERY_RETENTION = { standard: "2 months", premium: "4 months", keepsake: "6 months" };

// Custom inquiries borrow a base tier's pipeline rules once quoted -- Free
// isn't offered here since a paid custom package should never end up on
// a $0 ruleset.
const QUOTABLE_TIERS = ["standard", "premium", "keepsake"];
const INQUIRY_STATUS_LABEL = { new: "New", quoted: "Quoted", accepted: "Accepted", declined: "Declined" };
const INQUIRY_STATUS_COLOR = { new: "#C97A3D", quoted: "#C97A3D", accepted: "#7A8B76", declined: "#8a857d" };

export default function Dashboard() {
  return (
    <React.Suspense fallback={null}>
      <DashboardInner />
    </React.Suspense>
  );
}

function DashboardInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") === "custom" ? "custom" : "events");
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState(null);

  useEffect(() => {
    if (!selected && !selectedInquiry) return;
    const onKeyDown = (e) => { if (e.key === "Escape") { setSelected(null); setSelectedInquiry(null); } };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected, selectedInquiry]);

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

  const loadInquiries = useCallback(async () => {
    setInquiriesLoading(true);
    try {
      const res = await fetch("/api/admin/custom-inquiries");
      const data = await res.json();
      setInquiries(data.inquiries || []);
    } catch (err) {
      console.error("Failed to load custom inquiries", err);
      setInquiries([]);
    } finally {
      setInquiriesLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadInquiries(); }, [load, loadInquiries]);

  const updateStatus = async (id, newStatus) => {
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b)));
    if (selected?.id === id) setSelected((s) => ({ ...s, status: newStatus }));
    try {
      await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      console.error("Failed to save status change", err);
    }
  };

  const filtered = bookings
    .filter((b) => (filter === "all" ? true : b.status === filter))
    .filter((b) => (b.host_name || "").toLowerCase().includes(query.toLowerCase()) || (b.event_type || "").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const counts = STATUS_FLOW.reduce((acc, s) => { acc[s] = bookings.filter((b) => b.status === s).length; return acc; }, {});

  const filteredInquiries = inquiries
    .filter((i) => (i.host_name || "").toLowerCase().includes(query.toLowerCase()) || (i.event_type || "").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const newInquiryCount = inquiries.filter((i) => i.status === "new").length;

  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div {...(selected || selectedInquiry ? { inert: "" } : {})} style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 20px 60px" }}>
        <div style={{ marginBottom: "20px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 6px" }}>Recapped For You</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "28px", margin: 0 }}>{tab === "events" ? "Your events" : "Custom inquiries"}</h1>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "24px", borderBottom: "1px solid #E4DED2" }}>
          <button onClick={() => setTab("events")} style={{ padding: "10px 4px", background: "none", border: "none", borderBottom: tab === "events" ? "2px solid #C97A3D" : "2px solid transparent", color: tab === "events" ? "#211F1D" : "#8a857d", fontWeight: 600, fontSize: "14px", cursor: "pointer", marginBottom: "-1px" }}>
            Events
          </button>
          <button onClick={() => setTab("custom")} style={{ padding: "10px 4px", background: "none", border: "none", borderBottom: tab === "custom" ? "2px solid #C97A3D" : "2px solid transparent", color: tab === "custom" ? "#211F1D" : "#8a857d", fontWeight: 600, fontSize: "14px", cursor: "pointer", marginBottom: "-1px", display: "flex", alignItems: "center", gap: "6px" }}>
            Custom inquiries
            {newInquiryCount > 0 && <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: "#C97A3D", color: "#FFFFFF" }}>{newInquiryCount}</span>}
          </button>
        </div>

        {tab === "events" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "24px" }}>
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
                      <span style={{ fontSize: "12px", padding: "5px 10px", borderRadius: "999px", background: "#FAF7F2", color: STATUS_COLOR[b.status], border: `1px solid ${STATUS_COLOR[b.status]}44` }}>{STATUS_LABEL[b.status] || b.status}</span>
                      <ChevronRight size={16} color="#8a857d" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "custom" && (
          <>
            <div style={{ position: "relative", marginBottom: "20px" }}>
              <Search size={16} color="#8a857d" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by host or event type" style={{ width: "100%", padding: "12px 14px 12px 40px", borderRadius: "10px", border: "1px solid #E4DED2", background: "#FFFFFF", color: "#211F1D", fontSize: "14px", boxSizing: "border-box" }} />
            </div>

            {inquiriesLoading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#8a857d" }}>Loading inquiries…</div>
            ) : filteredInquiries.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#8a857d" }}>
                <Sparkles size={28} style={{ marginBottom: "10px", opacity: 0.6 }} />
                <div>No custom inquiries yet.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {filteredInquiries.map((i) => (
                  <button key={i.id} onClick={() => setSelectedInquiry(i)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: "12px", background: "#FFFFFF", border: "1px solid #E4DED2", cursor: "pointer", textAlign: "left" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "15px" }}>{i.host_name}</div>
                      <div style={{ fontSize: "13px", color: "#6b655c", marginTop: "3px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Calendar size={12} /> {formatDate(i.event_date)}</span>
                        <span>{i.event_type}</span>
                        {i.quoted_price_cents != null && <span>{formatDollars(i.quoted_price_cents)}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "12px", padding: "5px 10px", borderRadius: "999px", background: "#FAF7F2", color: INQUIRY_STATUS_COLOR[i.status], border: `1px solid ${INQUIRY_STATUS_COLOR[i.status]}44` }}>{INQUIRY_STATUS_LABEL[i.status] || i.status}</span>
                      <ChevronRight size={16} color="#8a857d" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", height: "100%", background: "#FFFFFF", borderLeft: "1px solid #E4DED2", padding: "28px 22px", overflowY: "auto", boxSizing: "border-box" }}>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8a857d", fontSize: "13px", cursor: "pointer", marginBottom: "18px", padding: 0 }}>← Back to list</button>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "0 0 4px" }}>{selected.host_name}</h2>
            <p style={{ color: "#6b655c", fontSize: "14px", margin: "0 0 22px" }}>{selected.event_type} · {formatDate(selected.event_date)}</p>

            <DetailRow label="Package" value={TIER_LABEL[selected.tier] || selected.tier} />
            {selected.upload_slug && (
              <div style={{ padding: "10px 0", borderBottom: "1px solid #E4DED2" }}>
                <a href={`/qr/${selected.upload_slug}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "13px", color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>
                  View / Share / Print Guest QR Code →
                </a>
              </div>
            )}
            <DetailRow label="Style" value={selected.style} />
            {selected.email && <DetailRow label="Email" value={selected.email} />}
            {selected.guest_count && <DetailRow label="Guests" value={selected.guest_count} />}
            {selected.roast_enabled && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #E4DED2", fontSize: "14px" }}>
                <span style={{ color: "#6b655c", display: "flex", alignItems: "center", gap: "5px" }}><Flame size={13} color="#C97A3D" /> Roast Reel</span>
                <span style={{ fontWeight: 500, color: "#C97A3D" }}>{ROAST_LABEL[selected.roast_level] || selected.roast_level}</span>
              </div>
            )}
            {selected.notes && <DetailRow label="Notes" value={selected.notes} />}

            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "12px", color: "#4a4642", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
              {!STATUS_FLOW.includes(selected.status) && (
                <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#FBEEE0", border: `1px solid ${STATUS_COLOR[selected.status] || "#D8CFC0"}`, marginBottom: "10px", fontSize: "14px", color: STATUS_COLOR[selected.status] || "#211F1D", fontWeight: 600 }}>
                  {STATUS_LABEL[selected.status] || selected.status}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", opacity: STATUS_FLOW.includes(selected.status) ? 1 : 0.5 }}>
                {STATUS_FLOW.map((s) => {
                  const active = s === selected.status;
                  const inFlow = STATUS_FLOW.includes(selected.status);
                  const done = inFlow && STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(selected.status);
                  return (
                    <button key={s} disabled={!inFlow} onClick={() => updateStatus(selected.id, s)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: inFlow ? "pointer" : "default", textAlign: "left", background: active ? "#FBEEE0" : "transparent", border: active ? "1px solid #C97A3D" : "1px solid transparent" }}>
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
              {selected.gallery_expires_at
                ? `until ${formatExpiryDate(selected.gallery_expires_at)}`
                : selected.tier === "free"
                ? "7 days, then permanently removed"
                : `${GALLERY_RETENTION[selected.tier] || "90 days"} after delivery`}.
            </div>
          </div>
        </div>
      )}

      {selectedInquiry && (
        <div onClick={() => setSelectedInquiry(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", height: "100%", background: "#FFFFFF", borderLeft: "1px solid #E4DED2", padding: "28px 22px", overflowY: "auto", boxSizing: "border-box" }}>
            <button onClick={() => setSelectedInquiry(null)} style={{ background: "none", border: "none", color: "#8a857d", fontSize: "13px", cursor: "pointer", marginBottom: "18px", padding: 0 }}>← Back to list</button>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "0 0 4px" }}>{selectedInquiry.host_name}</h2>
            <p style={{ color: "#6b655c", fontSize: "14px", margin: "0 0 22px" }}>{selectedInquiry.event_type} · {formatDate(selectedInquiry.event_date)}</p>

            <DetailRow label="Status" value={INQUIRY_STATUS_LABEL[selectedInquiry.status] || selectedInquiry.status} />
            <DetailRow label="Email" value={selectedInquiry.email} />
            {selectedInquiry.guest_count && <DetailRow label="Guests" value={selectedInquiry.guest_count} />}
            {selectedInquiry.style && <DetailRow label="Style preference" value={selectedInquiry.style} />}
            {selectedInquiry.notes && <DetailRow label="Notes" value={selectedInquiry.notes} />}

            <InquiryComposer
              inquiry={selectedInquiry}
              onSent={(updated) => {
                setSelectedInquiry(updated);
                loadInquiries();
              }}
            />

            {selectedInquiry.booking_id && (
              <div style={{ marginTop: "18px", padding: "14px", background: "#FBEEE0", border: "1px solid #C97A3D44", borderRadius: "10px", fontSize: "12px", color: "#8a5a2e", lineHeight: 1.6 }}>
                Accepted — this inquiry now has a real booking in the Events tab.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// One composer for everything sent to a host: a message, plus an optional
// price attached to that same message. Attaching a price is what actually
// creates/updates the quote and puts a working accept-&-pay link in the
// email the host receives -- there's no separate "just a message" vs
// "just a price" flow to juggle.
function InquiryComposer({ inquiry, onSent }) {
  const alreadyQuoted = inquiry.status !== "new";
  const [includeQuote, setIncludeQuote] = useState(alreadyQuoted && inquiry.status === "quoted");
  const [message, setMessage] = useState(inquiry.quote_message || "");
  const [decline, setDecline] = useState(false);
  const [tier, setTier] = useState(inquiry.quoted_tier || "premium");
  const [priceDollars, setPriceDollars] = useState(inquiry.quoted_price_cents != null ? String(inquiry.quoted_price_cents / 100) : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const quoteDisabled = inquiry.status === "accepted" || inquiry.status === "declined";
  if (inquiry.status === "accepted") return null;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/custom-inquiries/${inquiry.id}/${includeQuote ? "quote" : "reply"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(includeQuote ? { tier, priceDollars, message } : { message, decline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      onSent(data.inquiry);
      if (!includeQuote) { setMessage(""); setDecline(false); }
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ marginTop: "24px", padding: "16px", background: "#FAF7F2", border: "1px solid #E4DED2", borderRadius: "12px" }}>
      <div style={{ fontSize: "12px", color: "#4a4642", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
        {includeQuote ? (alreadyQuoted ? "Quote" : "Send a quote") : "Message"}
      </div>
      <p style={{ fontSize: "12px", color: "#8a857d", margin: "0 0 12px", lineHeight: 1.5 }}>
        {includeQuote ? "Attaching a price sends this message with a working accept-&-pay link." : "Ask a question or let them know before there's a price to discuss."}
      </p>

      {!quoteDisabled && (
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "14px", fontSize: "12.5px", color: "#4a4642", fontWeight: 600 }}>
          <input type="checkbox" checked={includeQuote} onChange={(e) => setIncludeQuote(e.target.checked)} style={{ width: "15px", height: "15px", accentColor: "#C97A3D" }} />
          Attach a price quote
        </label>
      )}

      {includeQuote && (
        <>
          <label style={{ fontSize: "12.5px", color: "#4a4642", display: "block", marginBottom: "5px" }}>Base package (pipeline rules)</label>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            {QUOTABLE_TIERS.map((t) => (
              <button key={t} disabled={quoteDisabled} onClick={() => setTier(t)} aria-pressed={tier === t}
                style={{ flex: 1, padding: "8px 6px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: quoteDisabled ? "default" : "pointer",
                  background: tier === t ? "#FBEEE0" : "#FFFFFF", border: tier === t ? "1.5px solid #C97A3D" : "1px solid #D8CFC0", color: tier === t ? "#C97A3D" : "#4a4642" }}>
                {TIER_LABEL[t]}
              </button>
            ))}
          </div>

          <label htmlFor="quote-price" style={{ fontSize: "12.5px", color: "#4a4642", display: "block", marginBottom: "5px" }}>Price ($)</label>
          <input id="quote-price" type="number" min="1" step="1" disabled={quoteDisabled} value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)}
            placeholder="e.g. 150" style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "14px", marginBottom: "12px", boxSizing: "border-box" }} />
        </>
      )}

      <label htmlFor="composer-message" style={{ fontSize: "12.5px", color: "#4a4642", display: "block", marginBottom: "5px" }}>
        Message {includeQuote ? "(optional -- what's included, why this price)" : ""}
      </label>
      <textarea id="composer-message" disabled={includeQuote && quoteDisabled} value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
        placeholder={includeQuote ? "What's included, why this price…" : "e.g. Can you tell us more about..."}
        style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "13.5px", marginBottom: "12px", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />

      {!includeQuote && !quoteDisabled && (
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "12px", fontSize: "12.5px", color: "#4a4642" }}>
          <input type="checkbox" checked={decline} onChange={(e) => setDecline(e.target.checked)} style={{ width: "15px", height: "15px", accentColor: "#C97A3D" }} />
          This one isn't doable -- mark as declined
        </label>
      )}

      {error && <p role="alert" style={{ color: "#C97A3D", fontSize: "12.5px", marginBottom: "10px" }}>{error}</p>}

      {!(includeQuote && quoteDisabled) && (
        <button onClick={handleSend} disabled={sending || (includeQuote ? !priceDollars : !message.trim())}
          style={{ width: "100%", padding: "12px", borderRadius: "8px", border: includeQuote ? "none" : "1px solid #D8CFC0", cursor: sending ? "default" : "pointer",
            background: sent ? "#7A8B76" : includeQuote ? (!priceDollars ? "#E4DED2" : "#C97A3D") : "#FFFFFF",
            color: sent ? "#FFFFFF" : includeQuote ? (!priceDollars ? "#8a857d" : "#211F1D") : "#211F1D",
            fontSize: "14px", fontWeight: 700 }}>
          {sending ? "Sending…" : sent ? "Sent ✓" : includeQuote ? (alreadyQuoted ? "Update & resend quote" : "Send quote") : decline ? "Send reply & decline" : "Send reply"}
        </button>
      )}
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

function formatDollars(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

// For full ISO timestamps (e.g. gallery_expires_at) -- unlike event_date,
// these already include a time/offset, so appending "T00:00:00" the way
// formatDate does would corrupt the string instead of parsing it.
function formatExpiryDate(dateStr) {
  try { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
