"use client";
import React from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

export default function BookingSuccessPage() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");

  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
          <Check size={30} color="#211F1D" strokeWidth={2.5} />
        </div>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "28px", margin: "0 0 12px" }}>Payment confirmed</h1>
        <p style={{ color: "#a8a29a", fontSize: "15px", lineHeight: 1.6, margin: 0 }}>
          Your booking is complete. Check your email for your guest upload link and confirmation details.
        </p>
        {bookingId && (
          <p style={{ color: "#6a655e", fontSize: "12px", marginTop: "20px" }}>
            Booking reference: {bookingId}
          </p>
        )}
      </div>
    </div>
  );
}
