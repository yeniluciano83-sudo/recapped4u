"use client";
import React, { useState } from "react";
import { Calendar, Users, Sparkles, Package, Check, ArrowRight, ArrowLeft, Flame } from "lucide-react";

const TIERS = [
  { id: "free", name: "Free", price: "$0", tagline: "See it for yourself — no card required",
    features: ["AI-curated gallery (up to 20 photos)", "Short highlight video (60-90 sec)", "Choose your editing style", "Digital delivery", "Guests have 24hrs after the event to upload"] },
  { id: "standard", name: "Classic", price: "$35", tagline: "Everything you need, nothing extra",
    features: ["Unlimited photo & video uploads", "Shareable + printable QR code & link", "48-hour upload window after your event", "AI-curated photo gallery", "One recap video", "Choose your editing style", "Digital delivery"] },
  { id: "premium", name: "Signature", price: "$75", tagline: "Make it unmistakably yours",
    features: ["Everything in Classic", "Social cut (60-90 sec) + full cut", "Choose your editing style, plus a separate theme for your social cut", "Star must-include photos for your social cut", "Roast Reel add-on eligible for select event types (+$20)", "1-week upload deadline", "Downloadable gallery for 4 months"], highlight: true },
  { id: "keepsake", name: "Luxe", price: "$95", tagline: "The full treatment, built to last",
    features: ["Everything in Signature", "Choose your editing style, plus a separate theme for your social cut", "24-hour priority turnaround (without Roast Reel)", "Complimentary Roast Reel add-on for select event types", "2-week upload deadline", "Downloadable gallery for 6 months"] },
  { id: "custom", name: "Custom Package", price: "Contact us", tagline: "Built entirely around your event",
    features: ["Tailored scope, pricing, and timeline", "Choose your editing style (optional)", "For large events, multi-day coverage, or special requests", "We'll follow up by email to work out the details"] },
];

const STYLES = [
  { id: "cinematic", label: "Cinematic", desc: "Slow, emotional, warm color grade" },
  { id: "upbeat", label: "Upbeat", desc: "Fast cuts, high energy, beat-synced" },
  { id: "documentary", label: "Documentary", desc: "Minimal, candid, true to the moment" },
  { id: "retro", label: "Nostalgic / Retro", desc: "Warm film grain, vintage titles, scrapbook feel" },
  { id: "highlight", label: "Highlight Reel", desc: "Bold text call-outs, punchy sports-style energy" },
];

const EVENT_TYPES = ["Party", "Birthday", "Corporate Event", "Family Reunion", "Housewarming", "Retirement Party", "Baby Shower", "Graduation", "Anniversary", "Bachelor/Bachelorette Party", "Vacation", "Holiday Celebration", "Other"];

// Signature/Luxe only, per what those tiers actually advertise
// ("Social cut (60-90 sec) + full cut"). Roast eligibility happens to use
// the same two tiers but is a separate concern (also gated by event type).
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
// Matches what the homepage's Roast Reel card actually advertises --
// Premium/Keepsake tiers, and this specific set of event types.
const ROAST_ELIGIBLE_TIERS = ["premium", "keepsake"];
const ROAST_ELIGIBLE_EVENT_TYPES = ["Party", "Family Reunion", "Anniversary", "Bachelor/Bachelorette Party"];
// Signature charges extra for Roast Reel; Luxe includes it -- no entry
// here means "included, no extra charge."
const ROAST_ADDON_PRICE = { premium: 20 };
// Keep in sync with GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const GALLERY_RETENTION = { premium: "4 months", keepsake: "6 months" };
const ROAST_LEVELS = [
  { id: "light", label: "Light", desc: "Playful, gentle teasing" },
  { id: "lukewarm", label: "Lukewarm", desc: "Sharper, inside-joke energy" },
  { id: "hot", label: "Hot", desc: "Full send, close friends only" },
];

export default function BookingForm() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ hostName: "", email: "", eventType: "", eventTypeOther: "", eventDate: "", guestCount: "", tier: "", style: "", socialStyle: "", notes: "", roastEnabled: false, roastLevel: "light" });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const isRoastEligible = ROAST_ELIGIBLE_TIERS.includes(form.tier) && ROAST_ELIGIBLE_EVENT_TYPES.includes(form.eventType);
  const isSocialCutEligible = SOCIAL_CUT_ELIGIBLE_TIERS.includes(form.tier);
  const effectiveEventType = form.eventType === "Other" && form.eventTypeOther.trim()
    ? form.eventTypeOther.trim()
    : form.eventType;
  const isCustom = form.tier === "custom";
  const canProceed = () => {
    if (step === 1) return form.hostName && form.email && form.eventType && (form.eventType !== "Other" || form.eventTypeOther.trim()) && form.eventDate;
    if (step === 2) return form.tier;
    if (step === 3) return isCustom || form.style; // scope (incl. style) is worked out later for custom
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Custom has no fixed price to check out with -- this just sends an
      // inquiry email; the actual payment happens outside the app once
      // scope and price are worked out directly with the host.
      const endpoint = isCustom ? "/api/custom-inquiry" : "/api/bookings";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, eventType: effectiveEventType, roastEnabled: isRoastEligible && form.roastEnabled }) });
      const data = await res.json();
      if (!res.ok) {
        alert("Submission failed: " + (data.error || "Unknown error"));
        return;
      }
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
      setSubmitted(true);
    } catch (err) {
      console.error("Submission failed", err);
      alert("Submission failed. Please try again.");
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
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "26px", margin: "0 0 10px" }}>
            {form.tier === "custom" ? `Thanks, ${form.hostName.split(" ")[0]}` : `You're booked, ${form.hostName.split(" ")[0]}`}
          </h2>
          <p style={{ color: "#a8a29a", fontSize: "15px", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
            {form.tier === "custom"
              ? <>We've got your custom package inquiry and will follow up at <strong style={{ color: "#F7F3EC" }}>{form.email}</strong> to work out the details.</>
              : <>We'll email your upload link and QR code to <strong style={{ color: "#F7F3EC" }}>{form.email}</strong> within 24 hours, ready to share with guests on {form.eventDate}.</>}
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
          {isCustom && (
            <p style={{ fontSize: "13px", color: "#a8a29a", margin: "0 0 14px", lineHeight: 1.5 }}>
              Optional for a custom package -- pick one if you have a preference, or skip this and we'll work it out together.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {STYLES.map((s) => (
              <button key={s.id} onClick={() => update("style", s.id)} style={{ textAlign: "left", padding: "16px", borderRadius: "12px", cursor: "pointer", background: form.style === s.id ? "#332e28" : "#2a2723", border: form.style === s.id ? "1.5px solid #C97A3D" : "1px solid #3a3733" }}>
                <div style={{ fontWeight: 600, fontSize: "15px" }}>{s.label}</div>
                <div style={{ fontSize: "13px", color: "#a8a29a", marginTop: "2px" }}>{s.desc}</div>
              </button>
            ))}
          </div>

          {isSocialCutEligible && (
            <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: "#2a2723", border: "1px solid #3a3733" }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>Social cut theme</div>
              <p style={{ fontSize: "12.5px", color: "#a8a29a", margin: "4px 0 12px", lineHeight: 1.5 }}>
                Optional -- pick a different style for your 60-90 second social cut, or leave it matching your main style above. You can also change this (and star must-include photos) later from your QR share page.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {STYLES.map((s) => (
                  <button key={s.id} onClick={() => update("socialStyle", form.socialStyle === s.id ? "" : s.id)}
                    style={{
                      padding: "8px 13px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
                      border: form.socialStyle === s.id ? "1px solid #C97A3D" : "1px solid #4a4642",
                      background: form.socialStyle === s.id ? "#332e28" : "transparent",
                      color: form.socialStyle === s.id ? "#C97A3D" : "#8a857d",
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isRoastEligible && (
            <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: "#2a2723", border: form.roastEnabled ? "1.5px solid #C97A3D" : "1px solid #3a3733" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={form.roastEnabled} onChange={(e) => update("roastEnabled", e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "#C97A3D", flexShrink: 0 }} />
                <Flame size={17} color="#C97A3D" />
                <span style={{ fontWeight: 700, fontSize: "15px" }}>Add Roast Reel</span>
                <span style={{ fontSize: "10.5px", color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {ROAST_ADDON_PRICE[form.tier] ? `+$${ROAST_ADDON_PRICE[form.tier]}` : "Included"}
                </span>
              </label>
              <p style={{ fontSize: "12.5px", color: "#a8a29a", margin: "8px 0 0", lineHeight: 1.5 }}>
                Witty commentary layered over your photos. You approve the full script before anyone sees it.
              </p>
              {form.roastEnabled && (
                <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                  {ROAST_LEVELS.map((r) => (
                    <button key={r.id} onClick={() => update("roastLevel", r.id)} style={{ flex: "1 1 110px", textAlign: "left", padding: "10px 12px", borderRadius: "8px", cursor: "pointer", background: form.roastLevel === r.id ? "#332e28" : "#211F1D", border: form.roastLevel === r.id ? "1.5px solid #C97A3D" : "1px solid #4a4642" }}>
                      <div style={{ fontWeight: 600, fontSize: "12.5px" }}>{r.label}</div>
                      <div style={{ fontSize: "11px", color: "#8a857d", marginTop: "2px" }}>{r.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Field label="Anything we should know? (optional)">
            <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </Field>
        </StepBlock>
      )}

      {step === 4 && (
        <StepBlock icon={<Users size={20} color="#C97A3D" />} title={isCustom ? "Review your inquiry" : "Review your booking"}>
          <SummaryRow label="Host" value={form.hostName} />
          <SummaryRow label="Email" value={form.email} />
          <SummaryRow label="Event" value={`${effectiveEventType} — ${form.eventDate}`} />
          <SummaryRow label="Package" value={TIERS.find((t) => t.id === form.tier)?.name} />
          {!isCustom && <SummaryRow label="Style" value={STYLES.find((s) => s.id === form.style)?.label} />}
          {isSocialCutEligible && form.socialStyle && (
            <SummaryRow label="Social cut theme" value={STYLES.find((s) => s.id === form.socialStyle)?.label} />
          )}
          {isRoastEligible && form.roastEnabled && (
            <SummaryRow
              label="Roast Reel"
              value={`${ROAST_LEVELS.find((r) => r.id === form.roastLevel)?.label}${ROAST_ADDON_PRICE[form.tier] ? ` (+$${ROAST_ADDON_PRICE[form.tier]})` : " (included)"}`}
            />
          )}
          {!isCustom && (
            <SummaryRow label="Total" value={`$${(parseInt((TIERS.find((t) => t.id === form.tier)?.price || "$0").slice(1), 10) || 0) + (isRoastEligible && form.roastEnabled ? (ROAST_ADDON_PRICE[form.tier] || 0) : 0)}`} />
          )}
          <div style={{ marginTop: "20px", padding: "14px", background: "#2a2723", borderRadius: "10px", fontSize: "12px", color: "#8a857d", lineHeight: 1.6 }}>
            {isCustom
              ? "We'll email you back to work out scope and pricing -- nothing is charged by submitting this inquiry."
              : `By booking, you'll receive a service agreement by email. ${
                  form.tier === "free"
                    ? "Your interactive gallery stays active for 7 days after delivery; after that, your photos and video remain downloadable."
                    : `Your event gallery and video stay accessible for ${GALLERY_RETENTION[form.tier] || "90 days"} after delivery.`
                } Raw guest uploads are removed 30 days after final delivery. Cancel more than 24 hours before your event for a full refund; cancellations inside 24 hours aren't eligible for a refund.`}
          </div>
        </StepBlock>
      )}

      <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
        {step > 1 && <button onClick={() => setStep(step - 1)} style={backBtn}><ArrowLeft size={16} /> Back</button>}
        {step < 4 ? (
          <button onClick={() => canProceed() && setStep(step + 1)} disabled={!canProceed()} style={nextBtn(canProceed())}>Continue <ArrowRight size={16} /></button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting} style={nextBtn(true)}>
            {submitting ? (isCustom ? "Sending..." : "Booking...") : (isCustom ? "Send inquiry" : "Confirm booking")}
          </button>
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
