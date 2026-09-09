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

// Left-accent info panel -- the same visual language the emails already use
// for a callout (lib/email.js's calloutBox), rather than a flat all-around
// border, so a policy explanation reads as "note" the same way here as it
// does in someone's inbox.
function InfoPanel({ children }) {
  return (
    <div style={{ padding: "14px 16px", background: tone.surface, borderRadius: radius.md, border: `1px solid ${tone.line}`, borderLeft: `3px solid ${tone.clay}`, marginBottom: "24px", textAlign: "left" }}>
      {children}
    </div>
  );
}

export default function CancelBookingPage() {
  const params = useParams();
  const slug = params?.slug;
  // Host token from the emailed link -- the slug on its own is a guest
  // credential (it's on the QR poster), so it can't authorize cancelling.
  // See lib/hostToken.js.
  const hostToken = useSearchParams().get("t") || "";

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/cancel?t=${encodeURIComponent(hostToken)}`);
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

  const handleCancel = async () => {
    if (!window.confirm("Cancel this booking? This can't be undone.")) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/cancel?t=${encodeURIComponent(hostToken)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
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

  if (result || booking?.status === "cancelled") {
    const refunded = result ? result.refunded : booking.stripe_payment_status === "refunded";
    // Same three-way distinction as sendCancellationConfirmation in
    // lib/email.js -- !refunded is true for a Free booking (nothing was
    // ever charged), a paid booking cancelled inside the 24h window (the
    // real "too late" case), or a paid, timing-eligible booking whose
    // refund itself failed. Blaming all three on "wasn't eligible" told a
    // Free-tier host who cancelled weeks out that they'd cancelled too
    // late, which was simply false.
    const noRefundReason =
      booking.tier === "free"
        ? "This was a free booking, so there was nothing to refund."
        : "This cancellation wasn't eligible for a refund.";
    return (
      <PageShell>
        <IconBadge icon={CheckCircle2} variant="sage" className="success-pop" />
        <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(21px, 2.6vw, 26px)", margin: "0 0 10px" }}>Booking cancelled</h1>
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          {refunded
            ? `A full refund${result?.amountRefunded ? ` of ${result.amountRefunded}` : ""} is on its way to your original payment method.`
            : `A confirmation email is on its way. ${noRefundReason}`}
        </p>
      </PageShell>
    );
  }

  if (booking?.status === "delivered") {
    return (
      <PageShell>
        <IconBadge icon={AlertTriangle} />
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          This event has already been delivered and can't be cancelled online — <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: tone.clay }}>message us on WhatsApp</a> and we'll help.
        </p>
      </PageShell>
    );
  }

  if (["analyzing", "editing", "awaiting_roast_approval"].includes(booking?.status)) {
    return (
      <PageShell>
        <IconBadge icon={AlertTriangle} />
        <p style={{ color: tone.body, fontSize: 15, lineHeight: 1.6 }}>
          This event's recap is already being put together and can't be cancelled online — <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: tone.clay }}>message us on WhatsApp</a> and we'll help.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontSize: "clamp(21px, 2.6vw, 26px)", margin: "0 0 8px" }}>
        Cancel {booking.host_name.split(" ")[0]}'s {booking.event_type}?
      </h1>
      <p style={{ color: tone.body, fontSize: 15, margin: "0 0 24px" }}>
        {formatDate(booking.event_date)} · {TIER_LABELS[booking.tier] || booking.tier}
      </p>

      <InfoPanel>
        <p style={{ fontSize: 15, color: tone.body, margin: 0, lineHeight: 1.6 }}>
          {booking.tier === "free"
            ? "This is a free booking, so there's nothing to refund — cancelling just closes the guest upload link for good."
            : info.refundEligible
            ? "You're more than 24 hours out from your event, so cancelling now qualifies for a full refund."
            : "This is within 24 hours of your event, so this cancellation won't be eligible for a refund per our policy."}
        </p>
      </InfoPanel>

      {error && <p role="alert" style={{ color: tone.clay, fontSize: 15, marginBottom: "14px" }}>{error}</p>}

      <button
        onClick={handleCancel}
        disabled={cancelling}
        style={{
          width: "100%", padding: "14px", borderRadius: radius.md, border: `1px solid ${tone.clay}`,
          background: "transparent", color: tone.clay, fontSize: "14px", fontWeight: 600,
          cursor: cancelling ? "default" : "pointer", opacity: cancelling ? 0.6 : 1,
        }}
      >
        {cancelling ? "Cancelling…" : "Cancel my booking"}
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
