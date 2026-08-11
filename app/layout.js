export const metadata = {
  title: "Recapped For You",
  description: "Curated event recap videos and photo galleries.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
