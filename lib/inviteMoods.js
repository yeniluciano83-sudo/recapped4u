// Visual mood for the shareable guest invite (app/api/invite/[bookingId]/route.js).
// Keyed off the exact strings in app/booking/page.jsx's EVENT_TYPES -- an
// unrecognized value (anything typed into the "Other" free-text field, or
// any event type added there later without a matching entry here) falls
// through to "generic" rather than throwing, which is also the deliberate
// default for the two entries that don't have a strong mood of their own
// (Party, Other).
//
// Every palette is a recolor of the same structure (a soft blob-glow
// background, one accent, one card surface) the rest of the site already
// uses -- see Section's `blob` prop and components/ui.jsx's `tone` -- so a
// themed invite still reads as this brand, not five unrelated designs.
const INVITE_MOODS = {
  romantic: { blobs: ["#E8B4B4", "#D9A5C0"], accent: "#B8697A", bg: "#FBF3F0", card: "#FFFFFF", text: "#3A2E2E", muted: "#8A756F" },
  festive: { blobs: ["#E0985A", "#C97A3D"], accent: "#C97A3D", bg: "#FDF3E7", card: "#FFFFFF", text: "#211F1D", muted: "#8A857D" },
  professional: { blobs: ["#3D5A5C", "#7A8B76"], accent: "#C9A45C", bg: "#1E2A2E", card: "#26343A", text: "#F5F1EA", muted: "#A9B3AE" },
  warm: { blobs: ["#97A893", "#7A8B76"], accent: "#7A8B76", bg: "#F3F6EF", card: "#FFFFFF", text: "#2B2F27", muted: "#7C8577" },
  // The site's own default palette (tone.clay/tone.cream in components/ui.jsx)
  // -- "a standard beautiful design" for anything without a specific mood.
  generic: { blobs: ["#C97A3D", "#E0985A"], accent: "#C97A3D", bg: "#FAF7F2", card: "#FFFFFF", text: "#211F1D", muted: "#8A857D" },
};

const EVENT_TYPE_MOOD = {
  "Wedding": "romantic",
  "Engagement Party": "romantic",
  "Bridal Shower": "romantic",
  "Anniversary": "romantic",
  "Birthday": "festive",
  "Gender Reveal": "festive",
  "Sweet 16/Quinceañera": "festive",
  "Retirement Party": "festive",
  "Graduation": "festive",
  "Bachelor/Bachelorette Party": "festive",
  "Holiday Celebration": "festive",
  "Corporate Event": "professional",
  "Fundraiser/Gala": "professional",
  "Family Reunion": "warm",
  "Class/Friend Reunion": "warm",
  "Housewarming": "warm",
  "Baby Shower": "warm",
  "Religious Ceremony": "warm",
  "Vacation": "warm",
};

export function getInviteMood(eventType) {
  const key = EVENT_TYPE_MOOD[eventType] || "generic";
  return { key, ...INVITE_MOODS[key] };
}
