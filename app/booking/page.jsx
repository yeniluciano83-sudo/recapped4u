"use client";
import React, { useState, useId, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, Users, Sparkles, Package, Check, ArrowRight, ArrowLeft, Flame, AlertTriangle, Play, Pause } from "lucide-react";

// Mirrors the STYLE_MUSIC map in scripts/auto-recap.js -- same files, served
// from public/ so they're directly playable here for a style preview.
const MUSIC_PREVIEW_URL = {
  cinematic: "/music/cinematic.mp3",
  upbeat: "/music/upbeat.mp3",
  documentary: "/music/documentary.mp3",
  retro: "/music/retro.mp3",
  highlight: "/music/highlight.mp3",
};

function StylePreviewButton({ styleId, playingId, onToggle }) {
  const url = MUSIC_PREVIEW_URL[styleId];
  if (!url) return null;
  const isPlaying = playingId === styleId;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(styleId); }}
      aria-label={isPlaying ? `Pause ${styleId} soundtrack preview` : `Preview ${styleId} soundtrack`}
      style={{
        position: "absolute", top: "50%", right: "10px", transform: "translateY(-50%)",
        width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid #D8CFC0", background: isPlaying ? "#C97A3D" : "#FFFFFF",
        color: isPlaying ? "#FFFFFF" : "#6b655c",
      }}>
      {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" style={{ marginLeft: "1px" }} />}
    </button>
  );
}

const TIERS = [
  { id: "free", name: "Free", price: "$0", tagline: "See it for yourself — no card required",
    features: ["Curated gallery (up to 20 photos)", "Short highlight video (60-90 sec)", "Choose your editing style", "Digital delivery", "Guests have 24hrs after the event to upload", "Add your own photos from your share page", "Close uploads early once everyone's uploaded", "Downloadable gallery for 7 days"] },
  { id: "standard", name: "Classic", price: "$35", tagline: "Everything you need, nothing extra",
    features: ["Unlimited photo uploads", "Shareable + printable QR code & link", "48-hour upload window after your event", "Every uploaded photo in your gallery", "One recap video", "Choose your editing style", "Digital delivery", "Downloadable gallery for 2 months", "Add your own photos from your share page", "Close uploads early once everyone's uploaded"] },
  { id: "premium", name: "Signature", price: "$75", tagline: "Make it unmistakably yours",
    features: ["Everything in Classic", "Social cut (60-90 sec) + full cut", "Choose your editing style, plus a separate theme for your social cut", "Star must-include photos for your social cut", "Roast Reel add-on eligible for any event type (+$20)", "1-week upload deadline", "Downloadable gallery for 4 months"], highlight: true },
  { id: "keepsake", name: "Luxe", price: "$95", tagline: "The full treatment, built to last",
    features: ["Everything in Signature", "5 social cuts instead of 1, each from a different set of your best photos", "Choose your editing style, plus a separate theme for your social cuts", "24-hour priority turnaround (without Roast Reel)", "Complimentary Roast Reel add-on for any event type", "2-week upload deadline, extendable by 2 more days if needed", "Downloadable gallery for 6 months"] },
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
// Social cut theme only ever drives which soundtrack plays under it (see
// socialMusicPath in scripts/auto-recap.js) -- "none" skips music
// entirely, distinct from leaving the picker unset (which falls back to
// matching the main video's style/music).
const SOCIAL_STYLE_OPTIONS = [...STYLES, { id: "none", label: "No theme (no music)" }];

const EVENT_TYPES = ["Party", "Birthday", "Wedding", "Engagement Party", "Bridal Shower", "Gender Reveal", "Sweet 16 / Quinceañera", "Corporate Event", "Family Reunion", "Class/Friend Reunion", "Housewarming", "Retirement Party", "Baby Shower", "Graduation", "Anniversary", "Bachelor/Bachelorette Party", "Religious Ceremony", "Fundraiser/Gala", "Vacation", "Holiday Celebration", "Other"];

// Signature/Luxe only, per what those tiers actually advertise
// ("Social cut (60-90 sec) + full cut"). Roast eligibility happens to use
// the same two tiers but is a separate concern.
const SOCIAL_CUT_ELIGIBLE_TIERS = ["premium", "keepsake"];
// Matches what the homepage's Roast Reel card actually advertises --
// Premium/Keepsake tiers, available for any event type.
const ROAST_ELIGIBLE_TIERS = ["premium", "keepsake"];
// Signature charges extra for Roast Reel; Luxe includes it -- no entry
// here means "included, no extra charge."
const ROAST_ADDON_PRICE = { premium: 20 };
// Keep in sync with GALLERY_EXPIRY_MONTHS in scripts/auto-recap.js.
const GALLERY_RETENTION = { standard: "2 months", premium: "4 months", keepsake: "6 months" };
const ROAST_LEVELS = [
  { id: "light", label: "Light", desc: "Playful, gentle teasing" },
  { id: "lukewarm", label: "Lukewarm", desc: "Sharper, inside-joke energy" },
  { id: "hot", label: "Hot", desc: "Full send, close friends only" },
];

export default function BookingForm() {
  return (
    <React.Suspense fallback={null}>
      <BookingFormInner />
    </React.Suspense>
  );
}

function BookingFormInner() {
  const searchParams = useSearchParams();
  const confirmError = searchParams.get("confirm_error") === "1";
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ hostName: "", email: "", eventType: "", eventTypeOther: "", eventDate: "", guestCount: "", tier: "", style: "", socialStyle: "", notes: "", roastEnabled: false, roastLevel: "light", deliveryFormat: "recap", fullVideoNoMusic: false });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  // One shared <audio> element for every style preview button on this page --
  // starting a new preview stops whatever was already playing, so hosts
  // never get two soundtracks layered on top of each other.
  const previewAudioRef = useRef(null);
  const [previewingStyle, setPreviewingStyle] = useState(null);
  const togglePreview = (styleId) => {
    const audio = previewAudioRef.current || (previewAudioRef.current = new Audio());
    if (previewingStyle === styleId) {
      audio.pause();
      setPreviewingStyle(null);
      return;
    }
    audio.src = MUSIC_PREVIEW_URL[styleId];
    audio.currentTime = 0;
    audio.play().catch(() => {});
    audio.onended = () => setPreviewingStyle(null);
    setPreviewingStyle(styleId);
  };

  const isRoastEligible = ROAST_ELIGIBLE_TIERS.includes(form.tier);
  const isSocialCutEligible = SOCIAL_CUT_ELIGIBLE_TIERS.includes(form.tier);
  const isSocialCutsFormat = isSocialCutEligible && form.deliveryFormat === "social_cuts";
  // Social-cuts-only bookings have no full video, so there's nothing for a
  // separate "main style" to visually apply to -- the social cut theme IS
  // the style for the whole booking in that mode (still used for photo
  // color grading server-side; see enhancePhoto(buffer, booking.style) in
  // scripts/auto-recap.js). Falling back to it here means picking either
  // picker satisfies the requirement, instead of forcing hosts to also
  // click a main style card that visibly has nothing left to describe.
  const effectiveStyle = form.style || (isSocialCutsFormat ? form.socialStyle : "");
  const effectiveEventType = form.eventType === "Other" && form.eventTypeOther.trim()
    ? form.eventTypeOther.trim()
    : form.eventType;
  const isCustom = form.tier === "custom";
  const canProceed = () => {
    if (step === 1) return form.hostName && form.email && form.eventType && (form.eventType !== "Other" || form.eventTypeOther.trim()) && form.eventDate;
    if (step === 2) return form.tier;
    if (step === 3) return isCustom || effectiveStyle; // scope (incl. style) is worked out later for custom
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Custom has no fixed price to check out with -- this just sends an
      // inquiry email; the actual payment happens outside the app once
      // scope and price are worked out directly with the host.
      const endpoint = isCustom ? "/api/custom-inquiry" : "/api/bookings";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, style: effectiveStyle, eventType: effectiveEventType, roastEnabled: isRoastEligible && !isSocialCutsFormat && form.roastEnabled }) });
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
          <p style={{ color: "#4a4642", fontSize: "15px", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
            {form.tier === "custom"
              ? <>We've got your custom package inquiry and will follow up at <strong style={{ color: "#211F1D" }}>{form.email}</strong> to work out the details.</>
              : <>We'll email your upload link and QR code to <strong style={{ color: "#211F1D" }}>{form.email}</strong> within 24 hours, ready to share with guests on {form.eventDate}.</>}
          </p>
          {form.tier === "custom" && (
            <p style={{ color: "#8a857d", fontSize: "12.5px", marginTop: "14px" }}>
              <span aria-hidden="true">📱</span> Want a faster answer? Message us on WhatsApp (text only): <a href="https://wa.me/16465129151" target="_blank" rel="noopener noreferrer" style={{ color: "#C97A3D", fontWeight: 600, textDecoration: "none" }}>+1 (646) 512-9151</a>
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {confirmError && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "14px 16px", borderRadius: "10px", background: "#FBEEE0", border: "1px solid #E4DED2", marginBottom: "20px" }}>
          <AlertTriangle size={16} color="#C97A3D" style={{ flexShrink: 0, marginTop: "2px" }} />
          <p style={{ fontSize: "13px", color: "#4a4642", margin: 0, lineHeight: 1.5 }}>That confirmation link is invalid or expired. If you're trying to activate a free booking, check your email for the most recent confirmation link, or book again below.</p>
        </div>
      )}
      <div style={{ display: "flex", gap: "6px", marginBottom: "28px" }}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{ flex: 1, height: "3px", borderRadius: "2px", background: n <= step ? "#C97A3D" : "#E4DED2" }} />
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
              <button key={t.id} onClick={() => update("tier", t.id)} aria-pressed={form.tier === t.id} style={{ textAlign: "left", padding: "18px", borderRadius: "14px", cursor: "pointer", background: form.tier === t.id ? "#FBEEE0" : "#FFFFFF", border: form.tier === t.id ? "1.5px solid #C97A3D" : "1px solid #E4DED2" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: "16px", display: "flex", alignItems: "center", gap: "6px" }}>
                    {form.tier === t.id && <Check size={16} color="#C97A3D" strokeWidth={3} />} {t.name}
                  </span>
                  <span style={{ color: "#C97A3D", fontWeight: 700 }}>{t.price}</span>
                </div>
                <p style={{ fontSize: "13px", color: "#4a4642", margin: "4px 0 10px" }}>{t.tagline}</p>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "13px", color: "#6b655c" }}>
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
            <p style={{ fontSize: "13px", color: "#4a4642", margin: "0 0 14px", lineHeight: 1.5 }}>
              Optional for a custom package -- pick one if you have a preference, or skip this and we'll work it out together.
            </p>
          )}
          {isSocialCutsFormat && (
            <p style={{ fontSize: "13px", color: "#4a4642", margin: "0 0 14px", lineHeight: 1.5 }}>
              You've chosen social-cuts-only delivery, so there's no full video for this to apply to on its own -- pick one here, or just set a theme on your social cut below and that covers it.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {STYLES.map((s) => (
              <div key={s.id} style={{ position: "relative" }}>
                <button onClick={() => update("style", s.id)} aria-pressed={form.style === s.id} style={{ width: "100%", textAlign: "left", padding: "16px", paddingRight: "48px", borderRadius: "12px", cursor: "pointer", background: form.style === s.id ? "#FBEEE0" : "#FFFFFF", border: form.style === s.id ? "1.5px solid #C97A3D" : "1px solid #E4DED2" }}>
                  <div style={{ fontWeight: 600, fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
                    {form.style === s.id && <Check size={15} color="#C97A3D" strokeWidth={3} />} {s.label}
                  </div>
                  <div style={{ fontSize: "13px", color: "#4a4642", marginTop: "2px" }}>{s.desc}</div>
                </button>
                <StylePreviewButton styleId={s.id} playingId={previewingStyle} onToggle={togglePreview} />
              </div>
            ))}
          </div>

          {isSocialCutEligible && (
            <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: "#FFFFFF", border: "1px solid #E4DED2" }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>Social cut theme</div>
              <p style={{ fontSize: "12.5px", color: "#4a4642", margin: "4px 0 12px", lineHeight: 1.5 }}>
                Optional -- pick a different style for your 60-90 second social cut, leave it matching your main style above, or skip the theme's music entirely. You can also change this (and star must-include photos) later from your QR share page.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {SOCIAL_STYLE_OPTIONS.map((s) => (
                  <div key={s.id} style={{ position: "relative", display: "inline-flex" }}>
                    <button onClick={() => update("socialStyle", form.socialStyle === s.id ? "" : s.id)}
                      aria-pressed={form.socialStyle === s.id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "4px",
                        padding: MUSIC_PREVIEW_URL[s.id] ? "8px 34px 8px 13px" : "8px 13px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
                        border: form.socialStyle === s.id ? "1px solid #C97A3D" : "1px solid #D8CFC0",
                        background: form.socialStyle === s.id ? "#FBEEE0" : "transparent",
                        color: form.socialStyle === s.id ? "#C97A3D" : "#6b655c",
                      }}>
                      {form.socialStyle === s.id && <Check size={12} strokeWidth={3} />} {s.label}
                    </button>
                    <StylePreviewButton styleId={s.id} playingId={previewingStyle} onToggle={togglePreview} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isSocialCutEligible && (
            <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: "#FFFFFF", border: "1px solid #E4DED2" }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>Delivery format</div>
              <p style={{ fontSize: "12.5px", color: "#4a4642", margin: "4px 0 12px", lineHeight: 1.5 }}>
                Choose one -- a curated full recap video plus your social cut(s), or skip the full video for social cuts covering every photo guests upload.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { id: "recap", label: "Full recap video", desc: "A curated highlight video, plus your social cut(s)." },
                  { id: "social_cuts", label: "Social cuts of every photo", desc: "No full video -- as many social cuts as it takes to cover every photo you get uploaded." },
                ].map((opt) => (
                  <button key={opt.id} onClick={() => update("deliveryFormat", opt.id)} aria-pressed={form.deliveryFormat === opt.id}
                    style={{
                      textAlign: "left", padding: "12px 14px", borderRadius: "10px", cursor: "pointer",
                      background: form.deliveryFormat === opt.id ? "#FBEEE0" : "#FAF7F2",
                      border: form.deliveryFormat === opt.id ? "1.5px solid #C97A3D" : "1px solid #D8CFC0",
                    }}>
                    <div style={{ fontWeight: 600, fontSize: "13.5px", display: "flex", alignItems: "center", gap: "6px" }}>
                      {form.deliveryFormat === opt.id && <Check size={13} color="#C97A3D" strokeWidth={3} />} {opt.label}
                    </div>
                    <div style={{ fontSize: "12px", color: "#6b655c", marginTop: "2px" }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isSocialCutsFormat && (
            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginTop: "16px", padding: "14px 16px", borderRadius: "12px", background: "#FFFFFF", border: "1px solid #E4DED2" }}>
              <input type="checkbox" checked={form.fullVideoNoMusic} onChange={(e) => update("fullVideoNoMusic", e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "#C97A3D", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "13.5px" }}>No music on the full video</div>
                <div style={{ fontSize: "12px", color: "#6b655c", marginTop: "2px" }}>Skip the soundtrack on your full recap video{isSocialCutEligible ? " (your social cut keeps its music)" : ""}.</div>
              </div>
            </label>
          )}

          {isRoastEligible && !isSocialCutsFormat && (
            <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: "#FFFFFF", border: form.roastEnabled ? "1.5px solid #C97A3D" : "1px solid #E4DED2" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={form.roastEnabled} onChange={(e) => update("roastEnabled", e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "#C97A3D", flexShrink: 0 }} />
                <Flame size={17} color="#C97A3D" />
                <span style={{ fontWeight: 700, fontSize: "15px" }}>Add Roast Reel</span>
                <span style={{ fontSize: "10.5px", color: "#7A8B76", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {ROAST_ADDON_PRICE[form.tier] ? `+$${ROAST_ADDON_PRICE[form.tier]}` : "Included"}
                </span>
              </label>
              <p style={{ fontSize: "12.5px", color: "#4a4642", margin: "8px 0 0", lineHeight: 1.5 }}>
                Witty commentary layered over your photos. You'll get both a captioned cut and a caption-free version of the same video.
              </p>
              {form.roastEnabled && (
                <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                  {ROAST_LEVELS.map((r) => (
                    <button key={r.id} onClick={() => update("roastLevel", r.id)} aria-pressed={form.roastLevel === r.id} style={{ flex: "1 1 110px", textAlign: "left", padding: "10px 12px", borderRadius: "8px", cursor: "pointer", background: form.roastLevel === r.id ? "#FBEEE0" : "#FAF7F2", border: form.roastLevel === r.id ? "1.5px solid #C97A3D" : "1px solid #D8CFC0" }}>
                      <div style={{ fontWeight: 600, fontSize: "12.5px", display: "flex", alignItems: "center", gap: "4px" }}>
                        {form.roastLevel === r.id && <Check size={12} color="#C97A3D" strokeWidth={3} />} {r.label}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b655c", marginTop: "2px" }}>{r.desc}</div>
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
          {!isCustom && <SummaryRow label="Style" value={SOCIAL_STYLE_OPTIONS.find((s) => s.id === effectiveStyle)?.label} />}
          {isSocialCutEligible && form.socialStyle && (
            <SummaryRow label="Social cut theme" value={SOCIAL_STYLE_OPTIONS.find((s) => s.id === form.socialStyle)?.label} />
          )}
          {isSocialCutEligible && (
            <SummaryRow label="Delivery format" value={isSocialCutsFormat ? "Social cuts of every photo" : "Full recap video"} />
          )}
          {!isSocialCutsFormat && form.fullVideoNoMusic && <SummaryRow label="Full video music" value="Off" />}
          {isRoastEligible && !isSocialCutsFormat && form.roastEnabled && (
            <SummaryRow
              label="Roast Reel"
              value={`${ROAST_LEVELS.find((r) => r.id === form.roastLevel)?.label}${ROAST_ADDON_PRICE[form.tier] ? ` (+$${ROAST_ADDON_PRICE[form.tier]})` : " (included)"}`}
            />
          )}
          {!isCustom && (
            <SummaryRow label="Total" value={`$${(parseInt((TIERS.find((t) => t.id === form.tier)?.price || "$0").slice(1), 10) || 0) + (isRoastEligible && !isSocialCutsFormat && form.roastEnabled ? (ROAST_ADDON_PRICE[form.tier] || 0) : 0)}`} />
          )}
          <div style={{ marginTop: "20px", padding: "14px", background: "#FFFFFF", borderRadius: "10px", fontSize: "12px", color: "#6b655c", lineHeight: 1.6 }}>
            {isCustom
              ? "We'll email you back to work out scope and pricing -- nothing is charged by submitting this inquiry."
              : `By booking, you'll receive a service agreement by email. ${
                  form.tier === "free"
                    ? "Your gallery and video are downloadable for 7 days after delivery, after which they're permanently removed."
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

const visuallyHidden = { position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };

function Shell({ children }) {
  return (
    <main style={{ minHeight: "100vh", background: "#FAF7F2", color: "#211F1D", fontFamily: "var(--font-inter), system-ui, sans-serif", display: "flex", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ width: "100%", maxWidth: "460px" }}>
        <h1 style={visuallyHidden}>Book your event recap</h1>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <p style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A8B76", fontWeight: 600, margin: 0 }}>Recapped For You</p>
        </div>
        {children}
      </div>
    </main>
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
  const id = useId();
  return (
    <div style={{ marginBottom: "16px" }}>
      <label htmlFor={id} style={{ fontSize: "13px", color: "#4a4642", display: "block", marginBottom: "6px" }}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #E4DED2", fontSize: "14px" }}><span style={{ color: "#6b655c" }}>{label}</span><span style={{ fontWeight: 500 }}>{value || "—"}</span></div>;
}

const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "#FFFFFF", color: "#211F1D", fontSize: "15px", boxSizing: "border-box" };
const backBtn = { flex: "0 0 auto", padding: "13px 18px", borderRadius: "10px", border: "1px solid #D8CFC0", background: "transparent", color: "#4a4642", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" };
const nextBtn = (enabled) => ({ flex: 1, padding: "13px 18px", borderRadius: "10px", border: "none", background: enabled ? "#C97A3D" : "#E4DED2", color: enabled ? "#211F1D" : "#8a857d", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", cursor: enabled ? "pointer" : "default" });
