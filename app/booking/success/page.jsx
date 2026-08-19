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
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
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
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <Suspense fallback={<p style={{ color: "#4a4642" }}>Loading...</p>}>
        <SuccessContent />
      </Suspense>
    </main>
  );
}
