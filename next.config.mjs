/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel sets VERCEL_GIT_COMMIT_SHA automatically at build time (no
  // dashboard toggle needed). Baking it into the client bundle lets an
  // already-open upload page detect it's running an older deploy -- see
  // app/api/build-version/route.js and the staleness check in both upload
  // pages. Falls back to "dev" locally, where this var doesn't exist.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  },
};

export default nextConfig;
