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
  { id: "retro", label: "Nostalgic / Retro", desc: "Warm film grain, vintage titles, scrapbook feel" },
  { id: "highlight", label: "Highlight Reel", desc: "Bold text call-outs, punchy sports-style energy" },
];

const EVENT_TYPES = ["Party", "Birthday", "Corporate Event", "Family Reunion", "Housewarming", "Retirement Party", "Baby Shower", "Graduation", "Anniversary", "Bachelor/Bachelorette Party", "Vacation", "Holiday Celebration", "Other"];

export default function BookingForm() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ hostName: "", email: "", eventType: "", eventTypeOther: "", eventDate: "", guestCount: "", tier: "", style: "", notes: "" });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const effectiveEventType = form.eventType === "Other" && form.eventTypeOther.trim()
    ? form.eventTypeOther.trim()
    : form.eventType;
  const canProceed = () => {
    if (step === 1) return form.hostName && form.email && form.eventType && (form.eventType !== "Other" || form.eventTypeOther.trim()) && form.eventDate;
    if (step === 2) return form.tier;
    if (step === 3) return form.style;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, eventType: effectiveEventType }) });
      const data = await res.json();
      if (!res.ok) {
        alert("Booking failed: " + (data.error || "Unknown error"));
        return;
      }
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
      setSubmitted(true);
    } catch (err) {
      console.error("Booking failed", err);
      alert("Booking failed. Please try again.");
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
          {form.eventType === "Other" && (
            <Field label="What's the event?">
              <input style={inputStyle} value={form.eventTypeOther} onChange={(e) => update("eventTypeOther", e.target.value)} placeholder="e.g. Engagement Party" />
            </Field>
          )}
          <Field label="Event date"><input style={inputStyle} type="date" value={form.eventDate} onChange={(e) => update("eventDate", e.target.value)} /></Field>
          <Field label="Estimated guest count (optional)"><input style={inputStyle} type="number" value={form.guestCount} onChange={(e) => update("guestCount", e.target.value)} placeholder="e.g. 40" /></Field>
        </StepBlock>
      )}

      {step === 2 && (
        <StepBlock icon={<Package size={20} color="#C97A3D" />} title="Choose your package">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {TIERS.map((t) => (
              <button key={t.id} onClick={() => update("tier", t.id)} style={{ textAlign: "left", padding: "18px", borderRadius: "14px", cursor: "pointer", background: form.tier === t.id ? "#332e28" : "#2a2723", border: form.tier === t.id ? "1.5px solid #C97A3D" : "1px solid #3a3733" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: "16px" }}>{t.name}</span>
                  <span style={{ color: "#C97A3D", fontWeight: 700 }}>{t.price}</span>
                </div>
                <p style={{ fontSize: "13px", color: "#a8a29a", margin: "4px 0 10px" }}>{t.tagline}</p>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "13px", color: "#8a857d" }}>
                  {t.features.map((f) => <li key={f} style={{ display: "flex", gap: "6px", marginBottom: "4px" }}><Check size={13} color="#7A8B76" style={{ flexShrink: 0, marginTop: "2px" }} /> {f}</li>)}
                </ul>
              </button>
            ))}
          </div>
        </StepBlock>
      )}

      {step === 3 && (
        <StepBlock icon={<Sparkles size={20} color="#C97A3D" />} title="Pick your editing style">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {STYLES.map((s) => (
              <button key={s.id} onClick={() => update("style", s.id)} style={{ textAlign: "left", padding: "16px", borderRadius: "12px", cursor: "pointer", background: form.style === s.id ? "#332e28" : "#2a2723", border: form.style === s.id ? "1.5px solid #C97A3D" : "1px solid #3a3733" }}>
                <div style={{ fontWeight: 600, fontSize: "15px" }}>{s.label}</div>
                <div style={{ fontSize: "13px", color: "#a8a29a", marginTop: "2px" }}>{s.desc}</div>
              </button>
            ))}
          </div>
          <Field label="Anything we should know? (optional)">
            <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Key moments to look for, songs you love, people to feature..." />
          </Field>
        </StepBlock>
      )}

      {step === 4 && (
        <StepBlock icon={<Users size={20} color="#C97A3D" />} title="Review your booking">
          <SummaryRow label="Host" value={form.hostName} />
          <SummaryRow label="Email" value={form.email} />
          <SummaryRow label="Event" value={`${effectiveEventType} — ${form.eventDate}`} />
          <SummaryRow label="Package" value={TIERS.find((t) => t.id === form.tier)?.name} />
          <SummaryRow label="Style" value={STYLES.find((s) => s.id === form.style)?.label} />
          <div style={{ marginTop: "20px", padding: "14px", background: "#2a2723", borderRadius: "10px", fontSize: "12px", color: "#8a857d", lineHeight: 1.6 }}>
            By booking, you'll receive a service agreement by email. Your event gallery and video stay accessible for 90 days after delivery; raw guest uploads are removed 30 days after final delivery.
          </div>
        </StepBlock>
      )}

      <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
        {step > 1 && <button onClick={() => setStep(step - 1)} style={backBtn}><ArrowLeft size={16} /> Back</button>}
        {step < 4 ? (
          <button onClick={() => canProceed() && setStep(step + 1)} disabled={!canProceed()} style={nextBtn(canProceed())}>Continue <ArrowRight size={16} /></button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting} style={nextBtn(true)}>{submitting ? "Booking..." : "Confirm booking"}</button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#211F1D", color: "#F7F3EC", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ width: "100%", maxWidth: "460px" }}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: 0 }}>Recapped For You</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function StepBlock({ icon, title, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>{icon}<h2 style={{ fontFamily: "Georgia, serif", fontSize: "21px", margin: 0 }}>{title}</h2></div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: "16px" }}><label style={{ fontSize: "13px", color: "#a8a29a", display: "block", marginBottom: "6px" }}>{label}</label>{children}</div>;
}

function SummaryRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #3a3733", fontSize: "14px" }}><span style={{ color: "#8a857d" }}>{label}</span><span style={{ fontWeight: 500 }}>{value || "—"}</span></div>;
}

const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #4a4642", background: "#211F1D", color: "#F7F3EC", fontSize: "15px", outline: "none", boxSizing: "border-box" };
const backBtn = { flex: "0 0 auto", padding: "13px 18px", borderRadius: "10px", border: "1px solid #4a4642", background: "transparent", color: "#a8a29a", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" };
const nextBtn = (enabled) => ({ flex: 1, padding: "13px 18px", borderRadius: "10px", border: "none", background: enabled ? "#C97A3D" : "#4a4642", color: enabled ? "#211F1D" : "#8a857d", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", cursor: enabled ? "pointer" : "default" });
