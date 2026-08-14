import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const VALID_TEMPLATES = ["grid", "masonry", "slideshow", "polaroid", "fullbleed"];

// PATCH /api/gallery/[bookingid]/template  { template: "masonry" }
export async function PATCH(req, { params }) {
  const { bookingid } = params;

  try {
    const { template } = await req.json();

    if (!VALID_TEMPLATES.includes(template)) {
      return NextResponse.json({ error: "Invalid template" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ gallery_template: template })
      .eq("id", bookingid)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, gallery_template: data.gallery_template });
  } catch (err) {
    console.error("Template update failed:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
