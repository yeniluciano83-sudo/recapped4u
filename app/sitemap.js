export default function sitemap() {
  const baseUrl = process.env.APP_URL || "https://recappedforyou.com";
  // Only the public marketing/legal pages -- booking galleries, QR pages, and
  // upload links are per-customer unguessable URLs and shouldn't be listed.
  const routes = ["", "/booking", "/terms", "/privacy"];
  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    changeFrequency: "monthly",
  }));
}
