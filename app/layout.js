import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

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
    <html lang="en" className={inter.variable} style={{ colorScheme: "light" }}>
      <body style={{ colorScheme: "light" }}>{children}</body>
    </html>
  );
}
