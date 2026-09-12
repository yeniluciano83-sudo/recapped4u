// Visual mood for the shareable guest invite (app/api/invite/[slug]/route.js).
// Keyed off the exact strings in app/booking/page.jsx's EVENT_TYPES -- an
// unrecognized value (anything typed into the "Other" free-text field, or
// any event type added there later without a matching entry here) falls
// through to "generic" rather than throwing, which is also the deliberate
// default for "Other" specifically, the one entry with no real theme of
// its own.
//
// Driven by the event TYPE, not the booking's chosen video-editing style --
// tried style-driven theming first (cinematic -> a dark "professional"
// mood), but that put a somber dark card on, say, a wedding whenever the
// host happened to pick the cinematic video style, which doesn't match
// what anyone expects an invite for their own wedding to look like. Every
// mood here (bar "professional", which is deliberately still dark -- it's
// only ever reached by genuinely formal occasions) is a bright, light-
// background palette on purpose.
//
// Every palette is a recolor of the same structure (a soft blob-glow
// background, one accent, one card surface) the rest of the site already
// uses -- see Section's `blob` prop and components/ui.jsx's `tone` -- so a
// themed invite still reads as this brand, not five unrelated designs.
// `tagline` is the same idea applied to copy instead of color: one warm,
// occasion-appropriate line of personality the card wouldn't otherwise have
// room for.
const INVITE_MOODS = {
  romantic: {
    blobs: ["#E8B4B4", "#D9A5C0"], accent: "#B8697A", bg: "#FBF3F0", card: "#FFFFFF", text: "#3A2E2E", muted: "#8A756F",
    tagline: "We can't wait to celebrate with you",
  },
  festive: {
    blobs: ["#E0985A", "#C97A3D"], accent: "#C97A3D", bg: "#FDF3E7", card: "#FFFFFF", text: "#211F1D", muted: "#8A857D",
    tagline: "Let's make it a party to remember",
  },
  professional: {
    blobs: ["#3D5A5C", "#7A8B76"], accent: "#C9A45C", bg: "#1E2A2E", card: "#26343A", text: "#F5F1EA", muted: "#A9B3AE",
    tagline: "We look forward to your attendance",
  },
  warm: {
    blobs: ["#97A893", "#7A8B76"], accent: "#7A8B76", bg: "#F3F6EF", card: "#FFFFFF", text: "#2B2F27", muted: "#7C8577",
    tagline: "We'd love to have you there",
  },
  // Berry red + pine green + gold -- broad enough to read as "the holidays"
  // without committing to one specific holiday, which "Holiday Celebration"
  // itself doesn't specify.
  holiday: {
    blobs: ["#8B3A3A", "#2F4B3C"], accent: "#C9A45C", bg: "#FBF6EC", card: "#FFFFFF", text: "#2E2420", muted: "#8A756A",
    tagline: "Wishing you joy this season",
  },
  // Soft, dignified, and deliberately free of any single tradition's
  // iconography (this event type spans many) -- dove-grey and gold instead
  // of a specific symbol.
  reverent: {
    blobs: ["#C9BFA9", "#D9CFC0"], accent: "#B89B5E", bg: "#FAF8F3", card: "#FFFFFF", text: "#2E2A22", muted: "#8A8172",
    tagline: "With gratitude, we hope you'll join us",
  },
  // The site's own default palette (tone.clay/tone.cream in components/ui.jsx)
  // -- "a standard beautiful design" for anything without a specific mood.
  generic: {
    blobs: ["#C97A3D", "#E0985A"], accent: "#C97A3D", bg: "#FAF7F2", card: "#FFFFFF", text: "#211F1D", muted: "#8A857D",
    tagline: "We'd love for you to join us",
  },
};

const EVENT_TYPE_MOOD = {
  "Party": "festive",
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
  "Holiday Celebration": "holiday",
  "Corporate Event": "professional",
  "Fundraiser/Gala": "professional",
  "Family Reunion": "warm",
  "Class/Friend Reunion": "warm",
  "Housewarming": "warm",
  "Baby Shower": "warm",
  "Religious Ceremony": "reverent",
  "Vacation": "warm",
};

export function getInviteMood(eventType) {
  const key = EVENT_TYPE_MOOD[eventType] || "generic";
  return { key, ...INVITE_MOODS[key] };
}
