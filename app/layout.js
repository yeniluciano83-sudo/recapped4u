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
      <body style={{ colorScheme: "light" }}>{children}</body>
    </html>
  );
}
