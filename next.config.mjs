import withSerwistInit from "@serwist/next";

export const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co http://127.0.0.1:*",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* ws://127.0.0.1:*",
      // The PWA service worker (V2-07) is a classic same-origin worker
      // script; without this it falls back to script-src in some browsers
      // but is explicit here per the CSP audit this milestone requires.
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Plant Media uploads go through a Server Action and must fit under its
  // body size limit; the 1 MB default is well below the 10 MiB the media
  // upload itself enforces.
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

// V2-07 PWA service worker (Serwist). Disabled outside production builds:
// dev-mode service-worker behavior is not representative (see
// docs/OFFLINE_PWA.md) and would otherwise fight Next.js's dev HMR pipeline.
// `reloadOnOnline` is forced off so regaining connectivity never triggers an
// automatic page reload that could discard an in-progress offline form.
// Non-hashed server-rendered routes have no natural content hash to key
// their precache entry on, so each build run is stamped with its own
// revision - this is what lets service-worker activation safely discard the
// previous build's copy of these two routes instead of serving them stale
// forever (spec: "versioned static caches; clean obsolete caches safely").
const buildRevision = new Date().toISOString();

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: false,
  reloadOnOnline: false,
  disable: process.env.NODE_ENV !== "production",
  additionalPrecacheEntries: [
    { url: "/offline", revision: buildRevision },
    { url: "/field", revision: buildRevision },
  ],
});

export default withSerwist(nextConfig);
