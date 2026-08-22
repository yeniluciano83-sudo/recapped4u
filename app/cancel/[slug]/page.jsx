"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const TIER_LABELS = { free: "Free", standard: "Classic", premium: "Signature", keepsake: "Luxe" };

export default function CancelBookingPage() {
  const params = useParams();
  const slug = params?.slug;

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/cancel`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Event not found");
      setInfo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (slug) load(); }, [slug, load]);

  const handleCancel = async () => {
    if (!window.confirm("Cancel this booking? This can't be undone.")) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/cancel`, { method: "POST" });
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
        <p style={{ color: "#4a4642" }}>Loading…</p>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642" }}>{error}</p>
      </PageShell>
    );
  }

  const booking = info?.booking;

  if (result || booking?.status === "cancelled") {
    const refunded = result ? result.refunded : booking.stripe_payment_status === "refunded";
    return (
      <PageShell>
        <CheckCircle2 size={32} color="#7A8B76" style={{ marginBottom: 14 }} />
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "24px", margin: "0 0 10px" }}>Booking cancelled</h1>
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          {refunded
            ? `A full refund${result?.amountRefunded ? ` of ${result.amountRefunded}` : ""} is on its way to your original payment method.`
            : "A confirmation email is on its way. This cancellation wasn't eligible for a refund."}
        </p>
      </PageShell>
    );
  }

  if (booking?.status === "delivered") {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          This event has already been delivered and can't be cancelled online — reply to your confirmation email and we'll help.
        </p>
      </PageShell>
    );
  }

  if (["editing", "awaiting_roast_approval"].includes(booking?.status)) {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          This event's recap is already being put together and can't be cancelled online — reply to your confirmation email and we'll help.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "24px", margin: "0 0 8px" }}>
        Cancel {booking.host_name.split(" ")[0]}'s {booking.event_type}?
      </h1>
      <p style={{ color: "#4a4642", fontSize: "13px", margin: "0 0 24px" }}>
        {booking.event_date} · {TIER_LABELS[booking.tier] || booking.tier}
      </p>

      <div style={{ padding: "14px 16px", background: "#FFFFFF", borderRadius: "10px", border: "1px solid #E4DED2", marginBottom: "24px", textAlign: "left" }}>
        <p style={{ fontSize: "13px", color: "#4a4642", margin: 0, lineHeight: 1.6 }}>
          {info.refundEligible
            ? "You're more than 24 hours out from your event, so cancelling now qualifies for a full refund."
            : "This is within 24 hours of your event, so this cancellation won't be eligible for a refund per our policy."}
        </p>
      </div>

      {error && <p role="alert" style={{ color: "#C97A3D", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

      <button
        onClick={handleCancel}
        disabled={cancelling}
        style={{
          width: "100%", padding: "14px", borderRadius: "10px", border: "1px solid #C97A3D",
          background: "transparent", color: "#C97A3D", fontSize: "14px", fontWeight: 600,
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
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ maxWidth: "420px", textAlign: "center" }}>{children}</div>
    </main>
  );
}
