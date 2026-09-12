import { supabase } from "@/lib/supabase";
import EventPageClient from "./EventPageClient";

// A server component wrapper around EventPageClient (the actual guest
// upload/RSVP page, unchanged) purely so this route can export
// generateMetadata -- Next.js won't allow that export in a "use client"
// file. Without this, the guest link a host shares (via text/WhatsApp/
// "Copy link", or when the Web Share sheet's file attachment gets dropped
// by the receiving app -- see handleShareInvite in app/qr/[slug]/page.jsx)
// showed up as a bare, unstyled URL with no preview: nothing to tap on,
// nothing that looked like an invitation. Real Open Graph/Twitter card
// tags make that same plain link unfurl into the actual themed invite
// image in every major messaging app, and tapping that preview opens this
// same page -- the guest's RSVP + upload page -- directly.
export async function generateMetadata({ params }) {
  const { eventId } = await params;

  const { data: booking } = await supabase
    .from("bookings")
    .select("host_name, event_type")
    .eq("upload_slug", eventId)
    .single();

  const eventName = booking?.host_name
    ? `${booking.host_name}'s ${booking.event_type || "Event"}`
    : "You're Invited";
  const description = "RSVP and add your photos -- no app needed.";
  // The same digital invite image already generated for sharing (see
  // lib/inviteCard.js) -- one real asset, reused as the link preview
  // instead of a second image just for this.
  const imageUrl = `${process.env.APP_URL}/api/invite/${eventId}`;

  return {
    title: eventName,
    description,
    openGraph: {
      title: eventName,
      description,
      images: [{ url: imageUrl, width: 1080, height: 1920 }],
    },
    twitter: {
      card: "summary_large_image",
      title: eventName,
      description,
      images: [imageUrl],
    },
  };
}

export default function EventPage() {
  return <EventPageClient />;
}
