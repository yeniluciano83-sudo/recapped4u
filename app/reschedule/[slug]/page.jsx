"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Calendar } from "lucide-react";

const TIER_LABELS = { free: "Free", standard: "Highlight", premium: "Spotlight", keepsake: "Luxe" };

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

export default function ReschedulePage() {
  const params = useParams();
  const slug = params?.slug;
  // Host token from the emailed link -- the slug on its own is a guest
  // credential (it is on the QR poster), so it cannot authorize rescheduling.
  // See lib/hostToken.js.
  const hostToken = useSearchParams().get("t") || "";

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/reschedule?t=${encodeURIComponent(hostToken)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Event not found");
      setInfo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug, hostToken]);

  useEffect(() => { if (slug) load(); }, [slug, load]);

  const handleSubmit = async () => {
    if (!newDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/reschedule?t=${encodeURIComponent(hostToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reschedule");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <p style={{ color: "#4a4642" }}>Loading…</p>
      </PageShell>
    );
  }

  if (error && !info) {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642" }}>{error}</p>
      </PageShell>
    );
  }

  const booking = info?.booking;

  if (result) {
    return (
      <PageShell>
        <CheckCircle2 size={32} color="#7A8B76" className="success-pop" style={{ marginBottom: 14 }} />
        <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "24px", margin: "0 0 10px" }}>You're moved to {result.newDate}</h1>
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          A confirmation email is on its way. Your guest upload link and QR code stay exactly the same — no need to re-share anything.
        </p>
      </PageShell>
    );
  }

  if (booking?.status === "cancelled") {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          This booking has been cancelled, so there's no event to reschedule.
        </p>
      </PageShell>
    );
  }

  if (!info.rescheduleEligible) {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          {booking.status === "delivered"
            ? "This event has already been delivered and can't be rescheduled online — "
            : "This is within 24 hours of your event (or already being processed), so it's too late to reschedule online — "}
          <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: "#C97A3D" }}>message us on WhatsApp</a> and we'll help.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Calendar size={26} color="#C97A3D" style={{ marginBottom: 14 }} />
      <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "24px", margin: "0 0 8px" }}>
        Reschedule {booking.host_name.split(" ")[0]}'s {booking.event_type}
      </h1>
      <p style={{ color: "#4a4642", fontSize: "13px", margin: "0 0 24px" }}>
        Currently {formatDate(booking.event_date)} · {TIER_LABELS[booking.tier] || booking.tier}
      </p>

      <div style={{ padding: "14px 16px", background: "#FFFFFF", borderRadius: "10px", border: "1px solid #E4DED2", marginBottom: "20px", textAlign: "left" }}>
        <p style={{ fontSize: "13px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
          Pick a new date at least 24 hours from now — it's free, and your guest upload link and QR code won't change.
        </p>
      </div>

      <label htmlFor="new-date-input" style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px", textAlign: "left" }}>New event date</label>
      <input
        id="new-date-input"
        type="date"
        value={newDate}
        onChange={(e) => setNewDate(e.target.value)}
        style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", marginBottom: "16px", boxSizing: "border-box" }}
      />

      {error && <p role="alert" style={{ color: "#C97A3D", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !newDate}
        style={{
          width: "100%", padding: "14px", borderRadius: "10px", border: "none",
          background: !newDate ? "#E4DED2" : "#C97A3D", color: !newDate ? "#8a857d" : "#211F1D",
          fontSize: "15px", fontWeight: 700, cursor: submitting || !newDate ? "default" : "pointer",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "Rescheduling…" : "Confirm new date"}
      </button>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        .success-pop { animation: success-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes success-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .success-pop { animation: none; } }
      `}</style>
      <div style={{ maxWidth: "420px", textAlign: "center" }}>{children}</div>
    </main>
  );
}
