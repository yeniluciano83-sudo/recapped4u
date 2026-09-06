import { describe, it, expect } from "vitest";
import { fieldStyle, buttonStyle, cardStyle, radius, tone, shadow } from "./ui.jsx";

// Locks the primitives to the hand-written styles they replaced.
//
// Five pages dropped their private copies and now render from these functions,
// so a change here restyles all of them at once. That's the point -- it's also
// the risk, and nothing else in the suite would catch it: these pages have no
// render tests, and a wrong colour or padding builds and ships perfectly
// happily.
//
// React treats 10 and "10px" identically for these properties, and colour case
// is irrelevant, so only genuine differences should surface.
const norm = (v) => (typeof v === "number" ? String(v) : String(v).replace(/px$/, "").toLowerCase());

function expectMatches(actual, expected) {
  for (const [k, v] of Object.entries(expected)) {
    expect(norm(actual[k]), `property "${k}"`).toBe(norm(v));
  }
}

describe("fieldStyle matches the inputs it replaced", () => {
  it("lg == booking/page.jsx", () => {
    expectMatches(fieldStyle({ size: "lg" }), {
      width: "100%", padding: "12px 14px", borderRadius: "10px",
      border: "1px solid #D8CFC0", background: "#FFFFFF",
      color: "#211F1D", fontSize: "15px", boxSizing: "border-box",
    });
  });

  it("md == dashboard/page.jsx", () => {
    expectMatches(fieldStyle({ size: "md" }), {
      width: "100%", padding: "10px 12px", borderRadius: "8px",
      border: "1px solid #D8CFC0", background: "#FFFFFF",
      color: "#211F1D", fontSize: "14px", boxSizing: "border-box",
    });
  });
});

describe("buttonStyle matches the buttons it replaced", () => {
  it("primary lg == qr primaryBtnStyle", () => {
    expectMatches({ ...buttonStyle({ variant: "primary", size: "lg" }), padding: "14px" }, {
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "14px", borderRadius: 10, border: "none",
      background: "#C97A3D", color: "#211F1D", fontSize: 15, fontWeight: 700, cursor: "pointer",
    });
  });

  it("secondary md == qr secondaryBtnStyle", () => {
    expectMatches({ ...buttonStyle({ variant: "secondary", size: "md" }), flex: 1, padding: "12px" }, {
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "12px", borderRadius: 10, border: "1px solid #D8CFC0",
      background: "transparent", color: "#211F1D", fontSize: 14, fontWeight: 600, cursor: "pointer",
    });
  });

  it("quiet sm == gallery iconBtnStyle", () => {
    expectMatches({ ...buttonStyle({ variant: "quiet", size: "sm" }), borderRadius: radius.sm, gap: "6px" }, {
      display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px",
      borderRadius: "8px", border: "1px solid #D8CFC0", background: "transparent",
      color: "#4a4642", fontSize: "13px", cursor: "pointer", textDecoration: "none",
    });
  });

  // Not a like-for-like carry-over: none of the originals set fontFamily, so
  // every button on the site was rendering in the browser's system UI face
  // rather than Inter. Inline styles don't inherit it the way a <div> does.
  // This is a deliberate fix, asserted so it can't be dropped again.
  it("inherits the page font, which the originals all failed to do", () => {
    for (const variant of ["primary", "secondary", "quiet"]) {
      expect(buttonStyle({ variant }).fontFamily).toBe("inherit");
    }
    expect(fieldStyle().fontFamily).toBe("inherit");
  });

  it("disabled greys out rather than going translucent, keeping its footprint", () => {
    const on = buttonStyle({ variant: "primary", size: "lg" });
    const off = buttonStyle({ variant: "primary", size: "lg", disabled: true });
    expect(off.background).toBe(tone.line);
    expect(off.color).toBe(tone.muted);
    expect(off.cursor).toBe("default");
    expect(off.padding).toBe(on.padding);
    expect(off.opacity).toBeUndefined();
  });
});

describe("cardStyle matches the card it replaced", () => {
  // The homepage now opts into raised: "sm" on top of this; the unraised form
  // is still what has to match the original hand-written object.
  it("unraised == the original homepage card, at its 14px radius", () => {
    expectMatches(cardStyle({ pad: 20, r: 14 }), {
      background: "#FFFFFF", border: "1px solid #E4DED2", borderRadius: 14, padding: 20,
    });
  });

  it("defaults to no shadow, so adopting Card can't add depth by surprise", () => {
    expect(cardStyle().boxShadow).toBe("none");
  });

  it("raising a card changes only its shadow", () => {
    const flat = cardStyle({ pad: 20, r: 14 });
    const lifted = cardStyle({ pad: 20, r: 14, raised: "sm" });
    expect(lifted.boxShadow).toBe(shadow.sm);
    for (const k of ["background", "border", "borderRadius", "padding"]) {
      expect(lifted[k]).toBe(flat[k]);
    }
  });
});

describe("tokens", () => {
  // Grey shadows over a cream ground read as dirt rather than depth. Every
  // shadow here is tinted with the ink or accent hue instead.
  it("has no neutral-grey shadows", () => {
    for (const [name, value] of Object.entries(shadow)) {
      if (value === "none") continue;
      expect(value, name).not.toMatch(/rgba\(0\s*,\s*0\s*,\s*0/);
      expect(value, name).toMatch(/rgba\((33,31,29|201,122,61)/);
    }
  });

  it("exposes three rectangle radii plus a pill, down from the six in use", () => {
    expect(Object.keys(radius).sort()).toEqual(["lg", "md", "pill", "sm"]);
    expect(radius.sm < radius.md && radius.md < radius.lg).toBe(true);
  });
});
