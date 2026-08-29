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
  sendFailureAlert,
  sendDeliveryNotification,
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
};

describe("email templates", () => {
  beforeEach(() => {
    resendMocks.send.mockReset();
    process.env.APP_URL = "https://test.example";
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
  });
});
