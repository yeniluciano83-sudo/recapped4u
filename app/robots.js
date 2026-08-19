export default function robots() {
  const baseUrl = process.env.APP_URL || "https://recappedforyou.com";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/dashboard-login", "/api/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
