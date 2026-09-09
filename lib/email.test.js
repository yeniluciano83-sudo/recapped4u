import { describe, it, expect, vi, beforeEach } from "vitest";

const resendMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    this.emails = { send: resendMocks.send };
  }),
}));

import {
  sendBookingConfirmation,
  sendConfirmBookingEmail,
  sendCancellationConfirmation,
  sendRescheduleConfirmation,
  sendUploadReminder,
  sendUploadCapReachedEmail,
  sendFailureAlert,
  sendDeliveryNotification,
  sendUpgradeConfirmation,
  sendNewBookingAlert,
} from "./email";

const BASE_BOOKING = {
  to: "jordan@example.com",
  hostName: "Jordan Smith",
  eventDate: "December 25, 2026",
  eventType: "Wedding",
  guestCount: 40,
  tier: "standard",
  style: "cinematic",
  amountPaid: "$99.00",
  roastEnabled: false,
  uploadUrl: "https://test.example/event/slug-1",
  uploadSlug: "slug-1",
  bookingId: "b1",
};

describe("email templates", () => {
  beforeEach(() => {
    resendMocks.send.mockReset();
    process.env.APP_URL = "https://test.example";
    // Host links are signed now (see lib/hostToken.js) and createHmac throws
    // on an undefined key.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-signing-secret";
  });

  // A real send to Gmail rendered with the whole background forced to
  // near-black -- the color-scheme meta tags alone don't stop Gmail's own
  // auto-dark-mode heuristic, which specifically looks for an
  // @media (prefers-color-scheme: dark) block as proof the email already
  // handles it. Every template goes through wrapEmail(), so one check here
  // covers all of them.
  describe("dark-mode safety (every template shares wrapEmail)", () => {
    it("declares light-only color-scheme and ships a dark-mode override block", async () => {
      await sendBookingConfirmation(BASE_BOOKING);
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain('content="light only"');
      expect(html).toContain("@media (prefers-color-scheme: dark)");
      expect(html).toContain("background-color: #FAF7F2 !important");
    });
  });

  describe("sendBookingConfirmation", () => {
    it("addresses the host by first name only", async () => {
      await sendBookingConfirmation(BASE_BOOKING);
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("You're all set, Jordan</h2>");
    });

    it("falls back to the raw tier/style id when it's not in the label maps", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "custom-tier", style: "custom-style" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("custom-tier");
      expect(html).toContain("custom-style");
    });

    it("includes the Roast Reel detail row only when roastEnabled is true", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, roastEnabled: false });
      expect(resendMocks.send.mock.calls[0][0].html).not.toContain("Roast Reel");

      await sendBookingConfirmation({ ...BASE_BOOKING, roastEnabled: true });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("Roast Reel");
    });

    it("mentions starring for the video on every tier, and social cuts too only on Spotlight/Luxe", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "standard" });
      const standardHtml = resendMocks.send.mock.calls[0][0].html;
      expect(standardHtml).toContain("Star your favorites");
      expect(standardHtml).not.toContain("social cuts get their own separate star picks");

      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "premium" });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("social cuts get their own separate star picks");
    });

    it("doesn't mention social cut star picks on a Spotlight/Luxe booking set to video_only", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "premium", deliveryFormat: "video_only" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("Star your favorites");
      expect(html).not.toContain("social cuts get their own separate star picks");
    });

    it("includes the deadline-extension detail row only for the keepsake tier", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "standard" });
      expect(resendMocks.send.mock.calls[0][0].html).not.toContain("Need more time?");

      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "keepsake" });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("Need more time?");
    });

    it("mentions permanent removal only for the free tier's retention line", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "free" });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("permanently removed");

      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "standard" });
      expect(resendMocks.send.mock.calls[1][0].html).not.toContain("permanently removed");
    });

    it("builds the QR code image URL from APP_URL and the upload slug", async () => {
      await sendBookingConfirmation(BASE_BOOKING);
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("https://test.example/api/qrcode/slug-1");
    });

    it("points questions at WhatsApp, not a reply-to-this-email address", async () => {
      await sendBookingConfirmation(BASE_BOOKING);
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("https://wa.me/16465129151");
      expect(html).not.toContain("reply to this email");
    });

    it("describes what's actually delivered, matching the chosen tier and delivery format", async () => {
      // Standard: one full video, no social cuts at all.
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "standard" });
      const standardHtml = resendMocks.send.mock.calls[0][0].html;
      expect(standardHtml).toContain("What you'll get");
      expect(standardHtml).toContain("One full recap video.");

      // Spotlight "recap" (default): full video + its real social cut count (5).
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "premium", deliveryFormat: "recap" });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("plus 5 social cuts");

      // Luxe "video_only": explicitly no social cuts, even though the tier could have them.
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "keepsake", deliveryFormat: "video_only" });
      expect(resendMocks.send.mock.calls[2][0].html).toContain("One full recap video — no social cuts.");

      // "social_cuts": no full video, cuts made from every photo.
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "premium", deliveryFormat: "social_cuts" });
      expect(resendMocks.send.mock.calls[3][0].html).toContain("no full video, but every photo guaranteed a spot somewhere");
    });

    it("mentions Luxe's faster turnaround, and every other tier's standard one", async () => {
      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "keepsake" });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("48 hours");

      await sendBookingConfirmation({ ...BASE_BOOKING, tier: "standard" });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("a few days");
    });
  });

  describe("sendConfirmBookingEmail", () => {
    it("sends to the given address with the confirm link included", async () => {
      await sendConfirmBookingEmail({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", eventType: "Wedding", confirmUrl: "https://test.example/confirm/tok" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.to).toBe("jordan@example.com");
      expect(call.html).toContain("https://test.example/confirm/tok");
    });
  });

  describe("sendCancellationConfirmation", () => {
    it("shows the refunded amount when refunded is true", async () => {
      await sendCancellationConfirmation({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", refunded: true, amountRefunded: "$35.00" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("$35.00");
      expect(html).toContain("has been issued");
    });

    it("explains the 24h policy instead when refunded is false", async () => {
      await sendCancellationConfirmation({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", refunded: false, amountRefunded: null });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("not eligible for a refund");
      expect(html).not.toContain("null");
    });

    it("points questions at WhatsApp, not a reply-to-this-email address", async () => {
      await sendCancellationConfirmation({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", refunded: false, amountRefunded: null });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("https://wa.me/16465129151");
      expect(html).not.toContain("reply to this email");
    });

    it("names which event was cancelled, not just the date", async () => {
      await sendCancellationConfirmation({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", eventDate: "Dec 25", refunded: false, amountRefunded: null });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("Your Wedding on Dec 25");
    });
  });

  describe("sendRescheduleConfirmation", () => {
    it("mentions both the old and new dates", async () => {
      await sendRescheduleConfirmation({ to: "jordan@example.com", hostName: "Jordan", oldDate: "Dec 25", newDate: "Jan 2" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("Dec 25");
      expect(html).toContain("Jan 2");
    });

    it("points questions at WhatsApp, not a reply-to-this-email address", async () => {
      await sendRescheduleConfirmation({ to: "jordan@example.com", hostName: "Jordan", oldDate: "Dec 25", newDate: "Jan 2" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("https://wa.me/16465129151");
      expect(html).not.toContain("reply to this email");
    });
  });

  describe("sendUploadReminder", () => {
    it("uses the standard-tier reminder timing when the tier isn't recognized", async () => {
      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "unknown-tier" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("Your recap starts processing in 24 hours");
    });

    it("reflects the keepsake tier's longer processing window in the subject", async () => {
      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "keepsake" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("Your recap starts processing in 7 days");
    });

    it("mentions the current upload count against the tier's real cap, including the zero case", async () => {
      // getUploadLimit("standard") === 500
      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "standard", uploadCount: 12 });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("12</strong> of 500 photos uploaded so far.");

      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "standard", uploadCount: 0 });
      expect(resendMocks.send.mock.calls[1][0].html).toContain("0</strong> of 500 photos uploaded so far.");
    });

    it("shows a reel bar (the same segmented-progress language as the upload pages) scaled to the tier's cap", async () => {
      // 24 segments total; 250 of 500 (standard's cap) should fill exactly half, i.e. 12.
      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "standard", uploadCount: 250 });
      const html = resendMocks.send.mock.calls[0][0].html;
      // Scoped to the reel bar's own cell markup, not just any element that
      // happens to share the accent color (the masthead badge also does).
      const filledCount = (html.match(/height: 8px; border-radius: 1px; background-color: #C97A3D;/g) || []).length;
      expect(filledCount).toBe(12);
    });

    it("omits the upload-count section entirely when uploadCount isn't given", async () => {
      await sendUploadReminder({ to: "jordan@example.com", hostName: "Jordan", eventDate: "Dec 25", uploadUrl: "https://test.example/event/slug-1", uploadSlug: "slug-1", tier: "standard" });
      expect(resendMocks.send.mock.calls[0][0].html).not.toContain("uploaded so far");
    });
  });

  describe("sendUploadCapReachedEmail", () => {
    it("names the event, the tier's label, and its exact cap in the body", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Jordan's Wedding", tier: "standard", uploadSlug: "slug-1", bookingId: "b1" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("You've hit Jordan's Wedding's upload limit");
      expect(call.html).toContain("Jordan's Wedding");
      expect(call.html).toContain("Highlight"); // TIER_LABELS.standard
      expect(call.html).toContain("500"); // getUploadLimit("standard")
    });

    it("mentions both ways to act on it -- deleting photos and closing uploads early", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier: "free", uploadSlug: "slug-1", bookingId: "b1" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.html.toLowerCase()).toContain("delete");
      expect(call.html.toLowerCase()).toContain("close uploads");
    });

    it("links to the host's own share page, signed the same way every other host link is", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier: "keepsake", uploadSlug: "slug-1", bookingId: "b1" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.html).toContain(`${process.env.APP_URL}/qr/slug-1?t=`);
    });

    it("reflects each tier's real cap, not a hardcoded number", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier: "premium", uploadSlug: "slug-1", bookingId: "b1" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.html).toContain("2000"); // getUploadLimit("premium")
    });

    it("offers the cheapest upgrade that actually raises the cap, with the right price difference and a link to the upgrade route", async () => {
      // standard ($35) -> premium ($75): a $40 difference, not premium's full $75.
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier: "standard", uploadSlug: "slug-1", bookingId: "b1" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("Upgrade to Spotlight");
      expect(html).toContain("+$40 more");
      expect(html).toContain("2000 photos");
      expect(html).toContain(`${process.env.APP_URL}/api/events/slug-1/upgrade?t=`);
    });

    it("doesn't also show a generic WhatsApp fallback once a self-service upgrade is offered", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier: "standard", uploadSlug: "slug-1", bookingId: "b1" });
      const html = resendMocks.send.mock.calls[0][0].html;
      // A self-service tier's only path to more room is the upgrade link --
      // no WhatsApp mention should be left duplicating that offer.
      expect(html.toLowerCase()).not.toContain("need more than");
      expect(html.toLowerCase()).not.toContain("whatsapp");
    });

    it("offers a custom plan via WhatsApp instead of a tier upgrade from Spotlight or Luxe -- they already share the top cap", async () => {
      for (const tier of ["premium", "keepsake"]) {
        await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Wedding", tier, uploadSlug: "slug-1", bookingId: "b1" });
      }
      const premiumHtml = resendMocks.send.mock.calls[0][0].html;
      const keepsakeHtml = resendMocks.send.mock.calls[1][0].html;
      for (const html of [premiumHtml, keepsakeHtml]) {
        expect(html).not.toContain("/upgrade?t="); // no self-service upgrade route -- there's no tier left to upgrade to
        expect(html.toLowerCase()).not.toContain("upgrade to");
        expect(html).toContain("Already on our biggest plan?");
        expect(html).toContain("wa.me/16465129151?text=");
      }
    });

    it("pre-fills the WhatsApp message with the event, tier, and cap so staff have context immediately", async () => {
      await sendUploadCapReachedEmail({ to: "jordan@example.com", hostName: "Jordan", eventType: "Priya's Wedding", tier: "keepsake", uploadSlug: "slug-1", bookingId: "b1" });
      const html = resendMocks.send.mock.calls[0][0].html;
      const decoded = decodeURIComponent(html.match(/wa\.me\/16465129151\?text=([^"&]+)/)[1]);
      expect(decoded).toContain("Priya's Wedding");
      expect(decoded).toContain("2000-photo limit");
      expect(decoded).toContain("Luxe");
    });
  });

  describe("sendUpgradeConfirmation", () => {
    it("states the new tier and its real upload cap", async () => {
      await sendUpgradeConfirmation({ to: "jordan@example.com", hostName: "Jordan", newTier: "premium" });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("You're upgraded to Spotlight");
      expect(call.html).toContain("Spotlight");
      expect(call.html).toContain("2000"); // getUploadLimit("premium")
    });

    it("reassures the guest link and QR code didn't change", async () => {
      await sendUpgradeConfirmation({ to: "jordan@example.com", hostName: "Jordan", newTier: "keepsake" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html.toLowerCase()).toContain("stays exactly the same");
    });
  });

  describe("sendNewBookingAlert", () => {
    it("names the host, event, and tier in the subject, and lists the details in the body", async () => {
      await sendNewBookingAlert({
        to: "ops@example.com",
        hostName: "Jordan Smith",
        email: "jordan@example.com",
        eventType: "Wedding",
        eventDate: "2026-12-25",
        tier: "premium",
        guestCount: 40,
        amountPaid: "$249.00",
        bookingId: "b1",
      });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.to).toBe("ops@example.com");
      expect(call.subject).toBe("New booking: Jordan Smith — Wedding (Spotlight)");
      expect(call.html).toContain("jordan@example.com");
      expect(call.html).toContain("$249.00");
      expect(call.html).toContain("b1");
    });

    it("falls back to the raw tier value when it's not a recognized label", async () => {
      await sendNewBookingAlert({
        to: "ops@example.com",
        hostName: "Jordan",
        email: "jordan@example.com",
        eventType: "Party",
        eventDate: "2026-12-25",
        tier: "custom-tier",
        guestCount: null,
        amountPaid: "$0.00",
        bookingId: "b2",
      });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toContain("(custom-tier)");
      expect(call.html).toContain("—"); // guestCount null renders as an em dash, not "null"
    });
  });

  describe("sendFailureAlert", () => {
    it("uses singular phrasing for exactly one failure", async () => {
      await sendFailureAlert({ to: "ops@example.com", failures: [{ bookingId: "b1", error: "boom" }] });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("Recap scheduler: 1 booking failed");
      expect(call.html).toContain("b1");
      expect(call.html).toContain("boom");
    });

    it("uses plural phrasing for multiple failures and renders a row per failure", async () => {
      await sendFailureAlert({
        to: "ops@example.com",
        failures: [{ bookingId: "b1", error: "boom" }, { bookingId: "b2", error: "kaboom" }],
      });
      const call = resendMocks.send.mock.calls[0][0];
      expect(call.subject).toBe("Recap scheduler: 2 bookings failed");
      expect(call.html).toContain("b1");
      expect(call.html).toContain("b2");
    });
  });

  describe("sendDeliveryNotification", () => {
    it("includes the gallery link and the expiry date", async () => {
      await sendDeliveryNotification({ to: "jordan@example.com", hostName: "Jordan", galleryUrl: "https://test.example/gallery/b1", expiresDate: "March 1, 2027" });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("https://test.example/gallery/b1");
      expect(html).toContain("March 1, 2027");
    });

    it("falls back to a generic description when hasFullVideo/socialCutCount aren't given", async () => {
      await sendDeliveryNotification({ to: "jordan@example.com", hostName: "Jordan", galleryUrl: "https://test.example/gallery/b1", expiresDate: "March 1, 2027" });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("Your video and photo gallery are ready");
    });

    it("names the full video and its real social cut count together", async () => {
      await sendDeliveryNotification({ to: "jordan@example.com", hostName: "Jordan", galleryUrl: "https://test.example/gallery/b1", expiresDate: "March 1, 2027", hasFullVideo: true, socialCutCount: 5 });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("Your full recap video, 5 social cuts");
    });

    it("mentions just the video when there are no social cuts", async () => {
      await sendDeliveryNotification({ to: "jordan@example.com", hostName: "Jordan", galleryUrl: "https://test.example/gallery/b1", expiresDate: "March 1, 2027", hasFullVideo: true, socialCutCount: 0 });
      expect(resendMocks.send.mock.calls[0][0].html).toContain("Your full recap video and photo gallery are ready.");
    });

    it("mentions just the social cuts on a social-cuts-only delivery, with no full video", async () => {
      await sendDeliveryNotification({ to: "jordan@example.com", hostName: "Jordan", galleryUrl: "https://test.example/gallery/b1", expiresDate: "March 1, 2027", hasFullVideo: false, socialCutCount: 12 });
      const html = resendMocks.send.mock.calls[0][0].html;
      expect(html).toContain("12 social cuts and your full photo gallery are ready.");
      expect(html).not.toContain("full recap video");
    });
  });
});
