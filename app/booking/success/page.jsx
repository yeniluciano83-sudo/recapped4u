"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const isEmailConfirm = searchParams.get("type") === "email";

  return (
    <div style={{ textAlign: "center", maxWidth: 420 }}>
      <div className="success-pop" style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
        <Check size={30} color="#211F1D" strokeWidth={2.5} />
      </div>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "28px", margin: "0 0 12px" }}>{isEmailConfirm ? "Booking activated" : "Payment confirmed"}</h1>
      <p style={{ color: "#4a4642", fontSize: "15px", lineHeight: 1.6, margin: 0 }}>
        Your booking is complete. Check your email for your guest upload link and confirmation details.
      </p>
      {bookingId && (
        <p style={{ color: "#8a857d", fontSize: "12px", marginTop: "20px" }}>
          Booking reference: {bookingId}
        </p>
      )}
      <a href="/" style={{ display: "inline-block", marginTop: "28px", background: "#C97A3D", color: "#211F1D", fontSize: 14, fontWeight: 700, padding: "12px 22px", borderRadius: 10, textDecoration: "none" }}>
        Back to homepage
      </a>
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <style>{`
        .success-pop { animation: success-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes success-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .success-pop { animation: none; } }
      `}</style>
      <Suspense fallback={<p style={{ color: "#4a4642" }}>Loading...</p>}>
        <SuccessContent />
      </Suspense>
    </main>
  );
}
