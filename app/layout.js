import { Inter, Fraunces } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

// Display face for headlines only -- body copy stays Inter. Every headline on
// the site already asked for a serif (`Georgia, serif`, 34 call sites), so
// this doesn't introduce a convention, it upgrades the one that was there:
// Georgia stays on as the fallback, and since it's a serif of similar colour
// and width, a slow font load degrades to something close rather than
// reflowing into a sans.
//
// No `weight` on purpose -- Fraunces is a variable font, so omitting it ships
// the whole 400-700 range in one file rather than discrete instances.
const fraunces = Fraunces({
  subsets: ["latin"],
  // opsz is Fraunces's optical-size axis. Shipping it makes the axis variable
  // rather than fixing a value, and browsers default to
  // `font-optical-sizing: auto`, so each headline picks its own optical size
  // from its rendered font-size -- the big hero gets tighter spacing and
  // sharper contrast, small headings get opened up, with no CSS per size.
  // That pairs with the clamp()-driven sizes in page.jsx, where a headline's
  // size isn't known ahead of time anyway.
  axes: ["opsz"],
  display: "swap",
  variable: "--font-fraunces",
});

// Without this, some Android browsers (Samsung Internet in particular)
// auto-apply their own "force dark" heuristic to any page that doesn't
// explicitly declare a color scheme -- confirmed live, it was darkening
// this site's cream background even though nothing here was ever built
// with a dark variant. Declaring "light" opts every page out of that.
export const viewport = {
  colorScheme: "light",
};

export const metadata = {
  metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
  title: "Recapped For You",
  description: "Curated event recap videos and photo galleries.",
  openGraph: {
    title: "Recapped For You",
    description: "Phone photos in. A full production out.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Recapped For You",
    description: "Phone photos in. A full production out.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} style={{ colorScheme: "light" }}>
      <body style={{ colorScheme: "light" }}>
        {children}
        <style>{`
          /* Global, site-wide -- every button/input/etc. on the site is a
             hand-styled inline object (557 of them, see components/ui.jsx),
             and none of them set outline, filter, or transform, so this adds
             clean without overriding or double-applying anything. Confirmed:
             zero existing :hover rules, zero inline filter on any button/a
             site-wide, and every disabled state uses the real disabled
             attribute (not just a style change), so :not(:disabled) works.

             :focus-visible needs no touch/mouse gating -- browsers already
             suppress it after a click or tap and show it only after real
             keyboard navigation, on every device. That's the built-in
             behavior the pseudo-class exists for. */
          button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
            outline: 2px solid #C97A3D;
            outline-offset: 2px;
          }

          /* Hover, unlike focus, has no such built-in protection -- gated
             behind (hover: hover) and (pointer: fine) so it only reaches an
             input that can genuinely hover with precision (mouse, trackpad,
             an iPad with a Magic Keyboard). Without this, mobile Safari/Chrome
             fake a hover on tap that can visibly stick until the next tap
             elsewhere -- exactly the bug this guards against. */
          @media (hover: hover) and (pointer: fine) {
            button:not(:disabled):hover, a:hover {
              filter: brightness(0.94);
              transform: translateY(-1px);
            }
          }
          button:not(:disabled), a {
            transition: filter 120ms ease, transform 120ms ease, outline-color 120ms ease;
          }

          /* Without this, selecting text anywhere on the site highlights it
             in the browser's default blue -- the one color on the page that
             was never chosen to be here, clashing with the warm cream/clay
             palette everywhere else. */
          ::selection {
            background: #C97A3D;
            color: #FFFFFF;
          }
        `}</style>
      </body>
    </html>
  );
}
