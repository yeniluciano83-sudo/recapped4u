"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Sparkles, Clock } from "lucide-react";

const TIER_LABELS = { standard: "Classic", premium: "Signature", keepsake: "Luxe" };

export default function CustomQuotePage() {
  const params = useParams();
  const id = params?.id;

  const [inquiry, setInquiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/custom-quote/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quote not found");
      setInquiry(data.inquiry);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/custom-quote/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start checkout");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <p style={{ color: "#4a4642" }}>Loading…</p>
      </PageShell>
    );
  }

  if (error && !inquiry) {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642" }}>{error}</p>
      </PageShell>
    );
  }

  if (inquiry.status === "new") {
    return (
      <PageShell>
        <Clock size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "0 0 10px" }}>Your quote isn't ready yet</h1>
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          We're still working out the details for {inquiry.event_type}. We'll email you as soon as it's ready — or reply to your inquiry email if you want to add anything in the meantime.
        </p>
      </PageShell>
    );
  }

  if (inquiry.status === "declined") {
    return (
      <PageShell>
        <AlertTriangle size={28} color="#C97A3D" style={{ marginBottom: 14 }} />
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          This inquiry didn't move forward. If that doesn't sound right, just reply to your inquiry email and we'll sort it out.
        </p>
      </PageShell>
    );
  }

  if (inquiry.status === "accepted") {
    return (
      <PageShell>
        <CheckCircle2 size={32} color="#7A8B76" style={{ marginBottom: 14 }} />
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "24px", margin: "0 0 10px" }}>You're all set</h1>
        <p style={{ color: "#4a4642", fontSize: "14px", lineHeight: 1.6 }}>
          This quote's already been accepted — check your email for your booking confirmation and guest upload link.
        </p>
      </PageShell>
    );
  }

  const priceFormatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((inquiry.quoted_price_cents || 0) / 100);

  return (
    <PageShell>
      <Sparkles size={26} color="#C97A3D" style={{ marginBottom: 14 }} />
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "24px", margin: "0 0 8px" }}>
        Your custom package for {inquiry.event_type}
      </h1>
      <p style={{ color: "#4a4642", fontSize: "13px", margin: "0 0 24px" }}>
        {inquiry.event_date} · Built on our {TIER_LABELS[inquiry.quoted_tier] || inquiry.quoted_tier} package
      </p>

      <div style={{ padding: "20px 22px", background: "#FFFFFF", borderRadius: "14px", border: "1px solid #E4DED2", marginBottom: "20px", textAlign: "left" }}>
        <p style={{ fontSize: "12px", color: "#7A8B76", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px", fontWeight: 600 }}>Quoted price</p>
        <p style={{ fontSize: "32px", fontWeight: 700, color: "#B85C1F", margin: "0 0 14px" }}>{priceFormatted}</p>
        {inquiry.quote_message && (
          <p style={{ fontSize: "14px", color: "#4a4642", lineHeight: 1.6, margin: 0, borderTop: "1px solid #E4DED2", paddingTop: "14px" }}>
            {inquiry.quote_message}
          </p>
        )}
      </div>

      {error && <p role="alert" style={{ color: "#C97A3D", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

      <button
        onClick={handleAccept}
        disabled={accepting}
        style={{
          width: "100%", padding: "14px", borderRadius: "10px", border: "none",
          background: "#C97A3D", color: "#211F1D",
          fontSize: "15px", fontWeight: 700, cursor: accepting ? "default" : "pointer",
          opacity: accepting ? 0.7 : 1,
        }}
      >
        {accepting ? "Redirecting to payment…" : "Accept & pay"}
      </button>
      <p style={{ fontSize: "12px", color: "#8a857d", marginTop: "16px", lineHeight: 1.6 }}>
        Want to talk it through first? Reply to your quote email — we're happy to adjust it.
      </p>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ maxWidth: "440px", textAlign: "center" }}>{children}</div>
    </main>
  );
}
