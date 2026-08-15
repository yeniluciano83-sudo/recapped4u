"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Calendar, Clock, CheckCircle2, Circle, Search, ChevronRight, Inbox, Flame } from "lucide-react";

const STATUS_FLOW = ["booked", "collecting", "editing", "delivered"];
const STATUS_LABEL = { booked: "Booked", collecting: "Collecting uploads", editing: "Editing", delivered: "Delivered" };
const STATUS_COLOR = { booked: "#7A8B76", collecting: "#C97A3D", editing: "#C97A3D", delivered: "#7A8B76" };
const TIER_LABEL = { standard: "Standard", premium: "Premium", keepsake: "Premium + Keepsake" };
const ROAST_LABEL = { light: "Light Roasting", lukewarm: "Lukewarm Roasting", hot: "Hot Roasting" };

export default function Dashboard() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

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

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 20px 60px" }}>
        <div style={{ marginBottom: "28px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: "0 0 6px" }}>Recapped For You</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "28px", margin: 0 }}>Your events</h1>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "24px" }}>
          {STATUS_FLOW.map((s) => (
            <button key={s} onClick={() => setFilter(filter === s ? "all" : s)} style={{ textAlign: "left", padding: "14px", borderRadius: "12px", cursor: "pointer", background: filter === s ? "#332e28" : "#2a2723", border: filter === s ? "1.5px solid #C97A3D" : "1px solid #3a3733" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: STATUS_COLOR[s] }}>{counts[s] || 0}</div>
              <div style={{ fontSize: "12px", color: "#a8a29a", marginTop: "2px" }}>{STATUS_LABEL[s]}</div>
            </button>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: "20px" }}>
          <Search size={16} color="#6a655e" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by host or event type" style={{ width: "100%", padding: "12px 14px 12px 40px", borderRadius: "10px", border: "1px solid #3a3733", background: "#2a2723", color: "#F7F3EC", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#6a655e" }}>Loading events…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#6a655e" }}>
            <Inbox size={28} style={{ marginBottom: "10px", opacity: 0.6 }} />
            <div>No events match here yet.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filtered.map((b) => (
              <button key={b.id} onClick={() => setSelected(b)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: "12px", background: "#2a2723", border: "1px solid #3a3733", cursor: "pointer", textAlign: "left" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
                    {b.host_name}
                    {b.roast_enabled && <Flame size={13} color="#C97A3D" title="Roast Reel add-on" />}
                  </div>
                  <div style={{ fontSize: "13px", color: "#8a857d", marginTop: "3px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Calendar size={12} /> {formatDate(b.event_date)}</span>
                    <span>{b.event_type}</span>
                    <span>{TIER_LABEL[b.tier] || b.tier}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", padding: "5px 10px", borderRadius: "999px", background: "#211F1D", color: STATUS_COLOR[b.status], border: `1px solid ${STATUS_COLOR[b.status]}44` }}>{STATUS_LABEL[b.status] || b.status}</span>
                  <ChevronRight size={16} color="#6a655e" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", height: "100%", background: "#211F1D", borderLeft: "1px solid #3a3733", padding: "28px 22px", overflowY: "auto", boxSizing: "border-box" }}>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#6a655e", fontSize: "13px", cursor: "pointer", marginBottom: "18px", padding: 0 }}>← Back to list</button>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "0 0 4px" }}>{selected.host_name}</h2>
            <p style={{ color: "#8a857d", fontSize: "14px", margin: "0 0 22px" }}>{selected.event_type} · {formatDate(selected.event_date)}</p>

            <DetailRow label="Package" value={TIER_LABEL[selected.tier] || selected.tier} />
            {selected.upload_slug && (
              <div style={{ padding: "10px 0", borderBottom: "1px solid #3a3733" }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #3a3733", fontSize: "14px" }}>
                <span style={{ color: "#8a857d", display: "flex", alignItems: "center", gap: "5px" }}><Flame size={13} color="#C97A3D" /> Roast Reel</span>
                <span style={{ fontWeight: 500, color: "#C97A3D" }}>{ROAST_LABEL[selected.roast_level] || selected.roast_level}</span>
              </div>
            )}
            {selected.notes && <DetailRow label="Notes" value={selected.notes} />}

            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "12px", color: "#a8a29a", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {STATUS_FLOW.map((s) => {
                  const active = s === selected.status;
                  const done = STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(selected.status);
                  return (
                    <button key={s} onClick={() => updateStatus(selected.id, s)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", textAlign: "left", background: active ? "#332e28" : "transparent", border: active ? "1px solid #C97A3D" : "1px solid transparent" }}>
                      {done || active ? <CheckCircle2 size={16} color={active ? "#C97A3D" : "#7A8B76"} /> : <Circle size={16} color="#4a4642" />}
                      <span style={{ fontSize: "14px", color: active ? "#F7F3EC" : "#a8a29a" }}>{STATUS_LABEL[s]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selected.roast_enabled && (
              <div style={{ marginTop: "18px", padding: "14px", background: "#332e28", border: "1px solid #C97A3D44", borderRadius: "10px", fontSize: "12px", color: "#c9a98d", lineHeight: 1.6 }}>
                <Flame size={12} style={{ marginRight: "5px", verticalAlign: "-1px" }} color="#C97A3D" />
                Reminder: review and get host approval on the Roast Reel script before sharing with guests.
              </div>
            )}

            <div style={{ marginTop: "18px", padding: "14px", background: "#2a2723", borderRadius: "10px", fontSize: "12px", color: "#8a857d", lineHeight: 1.6 }}>
              <Clock size={12} style={{ marginRight: "5px", verticalAlign: "-1px" }} />
              Raw uploads auto-remove 30 days after delivery. Gallery link stays live 90 days.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #3a3733", fontSize: "14px" }}><span style={{ color: "#8a857d" }}>{label}</span><span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span></div>;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}
