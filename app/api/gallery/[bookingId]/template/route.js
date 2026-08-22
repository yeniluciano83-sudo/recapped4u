import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Keep in sync with the templates app/gallery/[bookingId]/page.jsx actually
// renders -- "fullbleed" isn't implemented there, so accepting it here would
// silently store a value the gallery page can't render anything for.
const VALID_TEMPLATES = ["grid", "masonry", "slideshow", "polaroid"];

// PATCH /api/gallery/[bookingId]/template  { template: "masonry" }
export async function PATCH(req, { params }) {
  const { bookingId } = params;

  try {
    const { template } = await req.json();

    if (!VALID_TEMPLATES.includes(template)) {
      return NextResponse.json({ error: "Invalid template" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ gallery_template: template })
      .eq("id", bookingId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, gallery_template: data.gallery_template });
  } catch (err) {
    console.error("Template update failed:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
