// Shared visual primitives.
//
// The site is styled with inline style objects -- 557 of them across app/ --
// and the same three or four shapes are hand-written over and over: a white
// card on a warm border (40 white backgrounds, 28 identical borders), a coral
// primary button, an outlined secondary, a bordered input. Six near-duplicate
// style consts had already grown independently in four files, differing only
// in a padding value or a radius nobody chose deliberately.
//
// That duplication isn't just repetition, it's WHY the details drift: six
// distinct rectangle radii, and shadows on 6 elements out of a thousand. A
// change like "warm up every shadow" is currently a forty-file edit, which
// means it doesn't happen.
//
// Both forms are exported on purpose:
//
//   - the components (Card/Button/Field) for new code
//   - the style functions (cardStyle/buttonStyle/fieldStyle) so an existing
//     call site can drop its private copy and point at the shared definition
//     without being rewritten around a component boundary
//
// The style functions are what let this land safely: the 557 inline objects
// stay exactly where they are, and adoption happens file by file.

// --- tokens ----------------------------------------------------------------

// Sampled from what the site already uses rather than invented -- these are
// the values that were being retyped as hex literals (#C97A3D alone appears
// 32 times in app/page.jsx).
export const tone = {
  clay: "#C97A3D",      // primary accent
  clayLight: "#E0985A",
  sage: "#7A8B76",      // secondary accent
  ink: "#211F1D",       // primary text
  body: "#4A4642",      // body text
  muted: "#8A857D",     // supporting text
  line: "#E4DED2",      // card borders
  lineStrong: "#D8CFC0",// input + control borders
  surface: "#FFFFFF",
  cream: "#FAF7F2",     // page background
  creamWarm: "#FBEEE0", // tinted bands
};

// Three steps, down from the six rectangle radii in use (2, 4, 8, 10, 14, 16,
// 18). `pill` stays separate since it's a shape, not a step on the scale.
export const radius = { sm: 8, md: 10, lg: 16, pill: 999 };

// Warm-tinted, never neutral grey. A grey shadow over a cream ground reads as
// dirt rather than depth -- these carry the same hue as the ink colour, so
// they sit down into the page instead of smudging it.
export const shadow = {
  none: "none",
  sm: "0 1px 2px rgba(33,31,29,0.04), 0 2px 6px rgba(33,31,29,0.05)",
  md: "0 2px 4px rgba(33,31,29,0.05), 0 8px 20px rgba(33,31,29,0.06)",
  // For elements already carrying the accent colour, so the shadow inherits
  // the warmth of the thing casting it.
  clay: "0 2px 6px rgba(201,122,61,0.14), 0 10px 24px rgba(201,122,61,0.10)",
};

// --- style functions -------------------------------------------------------

export function cardStyle({ pad = 20, r = radius.lg, raised = "none" } = {}) {
  return {
    background: tone.surface,
    border: `1px solid ${tone.line}`,
    borderRadius: r,
    padding: pad,
    boxShadow: shadow[raised] ?? raised,
  };
}

// Hover and focus-visible are handled globally in app/layout.js, not per
// style here -- they apply to every native button/a/input on the site
// (hand-styled ones included), gated correctly for touch in the hover case.
// Adding filter/transform/outline in this object too would just double them.
const BUTTON_BASE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: radius.md,
  cursor: "pointer",
  textDecoration: "none",
  // Inline styles don't inherit the page font the way a div does -- a bare
  // <button> falls back to the browser's system UI face, which is the single
  // most common way a design like this quietly breaks.
  fontFamily: "inherit",
};

export function buttonStyle({ variant = "primary", size = "md", disabled = false } = {}) {
  const sizing = {
    sm: { padding: "8px 12px", fontSize: 13 },
    md: { padding: "12px 16px", fontSize: 14, fontWeight: 600 },
    lg: { padding: "14px 18px", fontSize: 15, fontWeight: 700 },
  }[size];

  const variants = {
    // Disabled keeps the same footprint and goes grey rather than
    // translucent, so a form's primary action doesn't appear to shift.
    primary: {
      border: "none",
      background: disabled ? tone.line : tone.clay,
      color: disabled ? tone.muted : tone.ink,
      cursor: disabled ? "default" : "pointer",
    },
    secondary: { border: `1px solid ${tone.lineStrong}`, background: "transparent", color: tone.ink },
    quiet: { border: `1px solid ${tone.lineStrong}`, background: "transparent", color: tone.body },
  };

  return { ...BUTTON_BASE, ...sizing, ...variants[variant] };
}

export function fieldStyle({ size = "md" } = {}) {
  const sizing = {
    md: { padding: "10px 12px", borderRadius: radius.sm, fontSize: 14 },
    lg: { padding: "12px 14px", borderRadius: radius.md, fontSize: 15 },
  }[size];
  return {
    width: "100%",
    border: `1px solid ${tone.lineStrong}`,
    background: tone.surface,
    color: tone.ink,
    boxSizing: "border-box",
    fontFamily: "inherit",
    ...sizing,
  };
}

// --- components ------------------------------------------------------------

// `style` is merged last throughout, so a call site can always override a
// token without needing an escape hatch or a new variant.

export function Card({ as: Tag = "div", pad, r, raised, style, children, ...rest }) {
  return (
    <Tag style={{ ...cardStyle({ pad, r, raised }), ...style }} {...rest}>
      {children}
    </Tag>
  );
}

export function Button({ as: Tag = "button", variant, size, disabled, style, children, ...rest }) {
  return (
    <Tag
      style={{ ...buttonStyle({ variant, size, disabled }), ...style }}
      {...(Tag === "button" ? { type: rest.type || "button", disabled } : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Field({ as: Tag = "input", size, style, ...rest }) {
  return <Tag style={{ ...fieldStyle({ size }), ...style }} {...rest} />;
}

// A branded loading placeholder: pulsing gradient badge + icon + message.
// Extracted from the pattern app/gallery/[bookingId]/page.jsx already built
// for its own initial load -- six other pages (qr share, qr upload, cancel,
// reschedule, booking success) were showing bare grey "Loading…" text with
// no styling at all while this exact treatment already existed one file
// over. The badge's shadow is the gallery page's original hand-picked value,
// not the shadow.clay token -- kept verbatim rather than switched to the
// token, since that would have quietly changed a look that already shipped.
//
// Deliberately unopinionated about its wrapper: some pages need a full
// <main style={{minHeight:"100vh",...}}>, others need to sit inside an
// existing <PageShell>. This renders just the badge and message; the caller
// supplies the surrounding layout, same as before.
export function LoadingState({ icon: Icon, label = "Loading…" }) {
  return (
    <>
      <style>{`
        .ui-loading-badge { animation: ui-loading-pulse 1.6s ease-in-out infinite; }
        @keyframes ui-loading-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.75; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ui-loading-badge { animation: none; }
        }
      `}</style>
      <div
        className="ui-loading-badge"
        style={{
          width: 52, height: 52, borderRadius: "50%", margin: "0 auto 16px",
          background: `linear-gradient(135deg, ${tone.clay}, ${tone.clayLight})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 14px rgba(201,122,61,0.32)",
        }}
      >
        {Icon && <Icon size={22} color={tone.surface} />}
      </div>
      <p style={{ fontSize: 15, color: tone.muted, textAlign: "center", margin: 0 }}>{label}</p>
    </>
  );
}
