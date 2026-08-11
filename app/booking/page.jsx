"use client";
import React, { useState } from "react";
import { Calendar, Users, Sparkles, Package, Check, ArrowRight, ArrowLeft } from "lucide-react";

const TIERS = [
  { id: "standard", name: "Standard", price: "$275", tagline: "One video, one style",
    features: ["AI-curated photo gallery", "One recap video (5-10 min)", "One editing style", "Digital delivery"] },
  { id: "premium", name: "Premium", price: "$425", tagline: "Two cuts, your style, your name in it",
    features: ["Everything in Standard", "Social cut (60-90 sec) + full cut", "Choose your editing style", "Editor's personal touch"], highlight: true },
  { id: "keepsake", name: "Premium + Keepsake", price: "$550", tagline: "Something to hold, not just watch",
    features: ["Everything in Premium", "Printed photo book", "Priority 48-72hr turnaround"] },
];

const STYLES = [
  { id: "cinematic", label: "Cinematic", desc: "Slow, emotional, warm color grade" },
  { id: "upbeat", label: "Upbeat", desc: "Fast cuts, high energy, beat-synced" },
  { id: "documentary", label: "Documentary", desc: "Minimal, candid, true to the moment" },
];

const EVENT_TYPES = ["Birthday", "Corporate Event", "Family Reunion", "Bar/Bat Mitzvah", "Retirement Party", "Baby Shower", "Graduation", "Anniversary", "Other"];

export default function BookingForm() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ hostName: "", email: "", eventType: "", eventDate: "", guestCount: "", tier: "", style: "", notes: "" });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const canProceed = () => {
    if (step === 1) return form.hostName && form.email && form.eventType && form.eventDate;
    if (step === 2) return form.tier;
    if (step === 3) return form.style;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
      setSubmitted(true);
    } catch (err) {
      console.error("Booking failed", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#C97A3D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Check size={28} color="#211F1D" strokeWidth={2.5} />
          </div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "26px", margin: "0 0 10px" }}>You're booked, {form.hostName.split(" ")[0]}</h2>
          <p style={{ color: "#a8a29a", fontSize: "15px", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
            We'll email your upload link and QR code to <strong style={{ color: "#F7F3EC" }}>{form.email}</strong> within 24 hours, ready to share with guests on {form.eventDate}.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ display: "flex", gap: "6px", marginBottom: "28px" }}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{ flex: 1, height: "3px", borderRadius: "2px", background: n <= step ? "#C97A3D" : "#3a3733" }} />
        ))}
      </div>

      {step === 1 && (
        <StepBlock icon={<Calendar size={20} color="#C97A3D" />} title="Tell us about the event">
          <Field label="Your name"><input style={inputStyle} value={form.hostName} onChange={(e) => update("hostName", e.target.value)} placeholder="Jordan Smith" /></Field>
          <Field label="Email"><input style={inputStyle} type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="jordan@email.com" /></Field>
          <Field label="Event type">
            <select style={inputStyle} value={form.eventType} onChange={(e) => update("eventType", e.target.value)}>
              <option value="">Select one</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Event date"><input style={inputStyle} type="date" value={form.eventDate} onChange={(e) => update("eventDate", e.target.value)} /></Field>
          <Field label="Estimated guest count (optional)"><input style={inputStyle} type="number" value={form.guestCount} onChange={(e) => update("guestCount"
