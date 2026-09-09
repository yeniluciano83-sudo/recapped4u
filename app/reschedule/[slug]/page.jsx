"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import { LoadingState, IconBadge, tone, radius } from "@/components/ui";

const TIER_LABELS = { free: "Free", standard: "Highlight", premium: "Spotlight", keepsake: "Luxe" };

function formatDate(dateStr) {
  if (!dateStr) return "";
  try { return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return dateStr; }
}

// Left-accent info panel -- same visual language as lib/email.js's
// calloutBox, rather than a flat all-around border.
function InfoPanel({ children }) {
  return (
    <div style={{ padding: "14px 16px", background: tone.surface, borderRadius: radius.md, border: `1px solid ${tone.line}`, borderLeft: `3px solid ${tone.clay}`, marginBottom: "20px", textAlign: "left" }}>
      {children}
    </div>
  );
}

// The same struck-through-old/bold-new two-column card sendRescheduleConfirmation
// builds in lib/email.js -- brought onto the page itself instead of only
// existing in the follow-up email, so confirming a new date feels like an
// actual calendar update at the moment it happens, not just a form submit.
function DateCard({ oldDate, newDate }) {
  return (
    <table role="presentation" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px", border: `1px solid ${tone.line}`, borderRadius: radius.md, background: tone.surface, overflow: "hidden" }}>
      <tbody>
        <tr>
          <td style={{ width: "50%", textAlign: "center", padding: "16px 8px", borderRight: `1px solid ${tone.line}` }}>
            <p style={{ margin: "0 0 4px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: tone.muted, fontWeight: 700 }}>Was</p>
            <p style={{ margin: 0, fontSize: 15, color: tone.muted, textDecoration: "line-through" }}>{oldDate}</p>
          </td>
          <td style={{ width: "50%", textAlign: "center", padding: "16px 8px" }}>
            <p style={{ margin: "0 0 4px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: tone.sage, fontWeight: 700 }}>Now</p>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: tone.ink }}>{newDate}</p>
          </td>
        </tr>
      </tbody>
    </table>
  );
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
        <LoadingState icon={Calendar} label="Loading…" />
      </PageShell>
    );
  }

  if (error && !info) {
    return (
      <PageShell>
        <IconBadge icon={AlertTriangle} />
        <p style={{ color: tone.body }}>{error}</p>
      </PageShell>
    );
  }

  const booking = info?.booking;

  if (result) {
    return (
      <PageShell>
        <IconBadge icon={CheckCircle2} variant="sage" className="success-pop" />
        <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(21px, 2.6vw, 26px)", margin: "0 0 14px" }}>You're moved</h1>
        <DateCard oldDate={formatDate(booking?.event_date)} newDate={formatDate(result.newDate)} />
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          A confirmation email is on its way. Your guest upload link and QR code stay exactly the same — no need to re-share anything.
        </p>
      </PageShell>
    );
  }

  if (booking?.status === "cancelled") {
    return (
      <PageShell>
        <IconBadge icon={AlertTriangle} />
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          This booking has been cancelled, so there's no event to reschedule.
        </p>
      </PageShell>
    );
  }

  if (!info.rescheduleEligible) {
    return (
      <PageShell>
        <IconBadge icon={AlertTriangle} />
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          {booking.status === "delivered"
            ? "This event has already been delivered and can't be rescheduled online — "
            : "This is within 24 hours of your event (or already being processed), so it's too late to reschedule online — "}
          <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: tone.clay }}>message us on WhatsApp</a> and we'll help.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <IconBadge icon={Calendar} />
      <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(21px, 2.6vw, 26px)", margin: "0 0 8px" }}>
        Reschedule {booking.host_name.split(" ")[0]}'s {booking.event_type}
      </h1>
      <p style={{ color: tone.body, fontSize: 15, margin: "0 0 24px" }}>
        Currently {formatDate(booking.event_date)} · {TIER_LABELS[booking.tier] || booking.tier}
      </p>

      <InfoPanel>
        <p style={{ fontSize: 15, color: tone.body, margin: 0, lineHeight: 1.6 }}>
          Pick a new date at least 24 hours from now — it's free, and your guest upload link and QR code won't change.
        </p>
      </InfoPanel>

      <label htmlFor="new-date-input" style={{ fontSize: "13px", color: tone.body, display: "block", marginBottom: "6px", textAlign: "left" }}>New event date</label>
      <input
        id="new-date-input"
        type="date"
        value={newDate}
        onChange={(e) => setNewDate(e.target.value)}
        style={{ width: "100%", padding: "12px 14px", borderRadius: radius.md, border: `1px solid ${tone.lineStrong}`, background: tone.surface, color: tone.ink, fontSize: "15px", marginBottom: "16px", boxSizing: "border-box" }}
      />

      {error && <p role="alert" style={{ color: tone.clay, fontSize: 15, marginBottom: "14px" }}>{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !newDate}
        style={{
          width: "100%", padding: "14px", borderRadius: radius.md, border: "none",
          background: !newDate ? tone.line : tone.clay, color: !newDate ? tone.muted : tone.ink,
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
    <main style={{ minHeight: "100vh", background: tone.cream, color: tone.ink, fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        .page-in { animation: page-fade-in 0.4s ease-out both; }
        .success-pop { animation: success-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes page-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes success-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .page-in, .success-pop { animation: none; } }
      `}</style>
      <div className="page-in" style={{ maxWidth: "420px", textAlign: "center" }}>{children}</div>
    </main>
  );
}
