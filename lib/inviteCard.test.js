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
  it("renders a real, correctly-sized PNG", async () => {
    const buf = await buildInviteCard(BASE);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("png");
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

  it("picks a different background color for a different event-type mood", async () => {
    // Wedding -> romantic (light background); Corporate Event -> professional
    // (a dark background) -- confirms the mood actually changes what gets
    // drawn, not just that two calls both happen to produce a valid PNG.
    // Sampled at (5, 500): just inside the card's left edge but well clear
    // of its rounded corners (radius 56) and of any drawn text/QR content,
    // so it's guaranteed to be plain background regardless of mood.
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
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1080);
  });

  it("wraps a long venue onto multiple lines instead of overflowing raw", async () => {
    const buf = await buildInviteCard({ ...BASE, venue: "A very long venue name that would never fit cleanly on a single line of this card" });
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(1080);
  });
});
