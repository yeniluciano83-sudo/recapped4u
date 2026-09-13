// Visual mood for the shareable guest invite (app/api/invite/[slug]/route.js).
// Keyed off the exact strings in app/booking/page.jsx's EVENT_TYPES -- an
// unrecognized value (anything typed into the "Other" free-text field, or
// any event type added there later without a matching entry here) falls
// through to "generic" rather than throwing, which is also the deliberate
// default for "Other" specifically, the one entry with no real theme of
// its own.
//
// Every mood shares one visual language now: a smooth creamy-white
// cardstock background with a single small blind-emboss motif (no ink, no
// color -- just raised paper catching soft light, see
// scripts/generate-invite-backgrounds.mjs) so the whole invite reads as
// one elegant, understated stationery line rather than eight unrelated
// designs. What actually tells one mood apart from another is `accent`
// (the one spot of real color, used for the eyebrow/tagline/divider) and
// `text` (the event details themselves) -- the "different color for the
// event details" the paper motif deliberately doesn't compete with.
// `tagline` is the same idea applied to copy instead of color: one warm,
// occasion-appropriate line of personality the card wouldn't otherwise
// have room for.
//
// Driven by the event TYPE, not the booking's chosen video-editing style --
// tried style-driven theming first (cinematic -> a dark "professional"
// mood), but that put a somber dark card on, say, a wedding whenever the
// host happened to pick the cinematic video style, which doesn't match
// what anyone expects an invite for their own wedding to look like.
const CREAM_BG = "#FAF6EE";
const CREAM_CARD = "#FFFFFF";

const INVITE_MOODS = {
  romantic: {
    blobs: ["#E8B4B4", "#D9A5C0"], accent: "#B8697A", bg: CREAM_BG, card: CREAM_CARD, text: "#3A2E2E", muted: "#8A756F",
    tagline: "We can't wait to celebrate with you",
  },
  // Split out of the old single "festive" mood -- Birthday, Gender Reveal
  // and Sweet 16/Quinceañera are all "someone's big day" milestones (a
  // cake makes sense), which reads differently from "party" below's
  // looser, no-specific-milestone celebrations.
  birthday: {
    blobs: ["#E8A0B4", "#E0985A"], accent: "#D9647F", bg: CREAM_BG, card: CREAM_CARD, text: "#2B211F", muted: "#8A756F",
    tagline: "Let's make today one to remember",
  },
  // The other half of the old "festive" split -- Party itself plus the
  // milestone-adjacent-but-not-a-birthday occasions (retirement,
  // graduation, a bachelor/ette night) that read more like "let's have a
  // good time" than "there's a cake."
  party: {
    // muted darkened from a lighter tint -- too washed-out for the venue
    // line (and footer text) against this mood's own light cream/white card.
    blobs: ["#B08AD9", "#E0985A"], accent: "#8B5FC7", bg: CREAM_BG, card: CREAM_CARD, text: "#211F1D", muted: "#6B5D4C",
    tagline: "Let's make it a party to remember",
  },
  professional: {
    blobs: ["#3D5A5C", "#7A8B76"], accent: "#8A6D3A", bg: CREAM_BG, card: CREAM_CARD, text: "#211F1D", muted: "#6B6558",
    tagline: "We look forward to your attendance",
  },
  warm: {
    blobs: ["#97A893", "#7A8B76"], accent: "#7A8B76", bg: CREAM_BG, card: CREAM_CARD, text: "#2B2F27", muted: "#7C8577",
    tagline: "We'd love to have you there",
  },
  // Berry red + pine green + gold -- broad enough to read as "the holidays"
  // without committing to one specific holiday, which "Holiday Celebration"
  // itself doesn't specify.
  holiday: {
    blobs: ["#8B3A3A", "#2F4B3C"], accent: "#9C5B3C", bg: CREAM_BG, card: CREAM_CARD, text: "#2E2420", muted: "#8A756A",
    tagline: "Wishing you joy this season",
  },
  // Soft, dignified, and deliberately free of any single tradition's
  // iconography (this event type spans many) -- dove-grey and gold instead
  // of a specific symbol.
  reverent: {
    blobs: ["#C9BFA9", "#D9CFC0"], accent: "#B89B5E", bg: CREAM_BG, card: CREAM_CARD, text: "#2E2A22", muted: "#8A8172",
    tagline: "With gratitude, we hope you'll join us",
  },
  // The site's own default palette (tone.clay/tone.cream in components/ui.jsx)
  // -- "a standard beautiful design" for anything without a specific mood.
  generic: {
    blobs: ["#C97A3D", "#E0985A"], accent: "#C97A3D", bg: CREAM_BG, card: CREAM_CARD, text: "#211F1D", muted: "#8A857D",
    tagline: "We'd love for you to join us",
  },
};

const EVENT_TYPE_MOOD = {
  "Party": "party",
  "Wedding": "romantic",
  "Engagement Party": "romantic",
  "Bridal Shower": "romantic",
  "Anniversary": "romantic",
  "Birthday": "birthday",
  "Gender Reveal": "birthday",
  "Sweet 16/Quinceañera": "birthday",
  "Retirement Party": "party",
  "Graduation": "party",
  "Bachelor/Bachelorette Party": "party",
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

// Every mood's background art is a blind-emboss paper relief (see
// scripts/generate-invite-backgrounds.mjs), but only these two keep
// upright, formal type -- corporate and religious ceremony invitations
// read as formal occasions, and an italic slant reads as playful/personal,
// which is exactly the note the other six moods are leaning into on
// purpose. Shared here (not just in lib/inviteCard.js, which uses it for
// the card's own vector-shear italic) so lib/email.js can apply the same
// split to real CSS font-style on the booking confirmation email without
// importing inviteCard.js just for one constant -- that module also
// synchronously parses the Oswald font file at import time, a cost an
// email template has no reason to pay.
export const NON_ITALIC_MOODS = new Set(["professional", "reverent"]);
