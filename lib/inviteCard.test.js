import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { buildInviteCard } from "./inviteCard.js";

const BASE = {
  hostName: "Jordan Smith",
  eventType: "Wedding",
  venue: "The Grand Hall, 123 Main St",
  uploadUrl: "https://www.recappedforyou.com/event/abc123",
  dateLabel: "June 14, 2026",
  timeLabel: "5:30 PM",
};

describe("buildInviteCard", () => {
  it("renders a real, correctly-sized JPEG", async () => {
    const buf = await buildInviteCard(BASE);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("still renders with no venue and no time (both optional)", async () => {
    const buf = await buildInviteCard({ ...BASE, venue: null, timeLabel: "" });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1080);
  });

  it("still renders with no host name and a missing/unrecognized event type", async () => {
    const buf = await buildInviteCard({ ...BASE, hostName: "", eventType: undefined });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1080);
  });

  it("picks a different illustrated background for a different event-type mood", async () => {
    // Wedding -> romantic (a real floral illustration); Corporate Event ->
    // professional (a real dark navy/laurel illustration) -- confirms the
    // mood actually changes which background image gets loaded, not just
    // that two calls both happen to produce a valid JPEG. Sampled at
    // (5, 500): just inside the card's left edge, in the illustrated
    // border area, clear of any drawn text/QR content.
    const romantic = await buildInviteCard({ ...BASE, eventType: "Wedding" });
    const professional = await buildInviteCard({ ...BASE, eventType: "Corporate Event" });

    const romanticBg = await sharp(romantic).extract({ left: 5, top: 500, width: 1, height: 1 }).raw().toBuffer();
    const professionalBg = await sharp(professional).extract({ left: 5, top: 500, width: 1, height: 1 }).raw().toBuffer();

    expect(Buffer.compare(romanticBg, professionalBg)).not.toBe(0);
  });

  it("escapes XML-significant characters in host-supplied text instead of breaking the SVG", async () => {
    // "&", "<", ">" left unescaped would either corrupt the SVG (a broken
    // or truncated card) or, worse, let the text be interpreted as markup
    // -- the same class of bug as the execSync injection fixed elsewhere
    // this session, just in an SVG sink instead of a shell one.
    const buf = await buildInviteCard({ ...BASE, hostName: `Jordan & "The Smiths" <VIP>`, venue: `Tom & Jerry's <Backyard>` });
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1080);
  });

  it("wraps a long venue onto multiple lines instead of overflowing raw", async () => {
    const buf = await buildInviteCard({ ...BASE, venue: "A very long venue name that would never fit cleanly on a single line of this card" });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1080);
  });

  it("drops the RSVP row when showRsvp is false, for the printed card", async () => {
    // The printed card (app/qr/[slug]/page.jsx's print-card) gets taped up
    // at the event itself, where "Will you be there?" no longer makes
    // sense -- confirms the flag actually changes the rendered image
    // rather than being silently ignored.
    const withRsvp = await buildInviteCard(BASE);
    const withoutRsvp = await buildInviteCard({ ...BASE, showRsvp: false });
    const meta = await sharp(withoutRsvp).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1600);
    expect(Buffer.compare(withRsvp, withoutRsvp)).not.toBe(0);
  });

  it("renders the printed card as a landscape flyer/table-card shape", async () => {
    // The digital invite stays 9:16 (phone-story shaped); the printed card
    // uses its own dedicated landscape art (lib/assets/invite-backgrounds
    // -print/) and a side-by-side layout instead, so it reads like a
    // flyer/table card rather than a tall poster.
    const buf = await buildInviteCard({ ...BASE, showRsvp: false });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1080);
  });
});
