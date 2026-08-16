"use client";
import React, { useState } from "react";

export default function DashboardLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await fetch("/api/dashboard-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/dashboard";
    } else {
      setError(true);
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 320 }}>
        <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, marginBottom: "20px", textAlign: "center" }}>
          Recapped For You — Staff Access
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ width: "100%", padding: "14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", outline: "none", boxSizing: "border-box", marginBottom: "12px" }}
        />
        <button type="submit" disabled={loading} style={{ width: "100%", padding: "14px", borderRadius: "10px", border: "none", background: "#C97A3D", color: "#211F1D", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Checking..." : "Enter"}
        </button>
        {error && <p style={{ color: "#e07a5f", fontSize: "13px", textAlign: "center", marginTop: "12px" }}>Incorrect password.</p>}
      </form>
    </div>
  );
}
