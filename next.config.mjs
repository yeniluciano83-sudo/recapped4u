/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  webpack: (config) => {
    // @sentry/node's OpenTelemetry-based auto-instrumentation uses a dynamic
    // require (require-in-the-middle) that webpack can't statically analyze.
    // Harmless -- Sentry works fine either way -- but noisy on every build.
    config.ignoreWarnings = [...(config.ignoreWarnings || []), { module: /require-in-the-middle/ }];
    return config;
  },
};

export default nextConfig;
