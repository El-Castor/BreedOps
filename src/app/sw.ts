import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
} from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Deliberately NOT @serwist/next/worker's `defaultCache`: its catch-all
// rules put authenticated same-origin HTML, RSC payloads and GET /api/*
// responses into long-lived caches (24h NetworkFirst), which is exactly
// what V2-07 §5 forbids ("Do NOT generically cache authenticated
// BreedOps HTML/API/RSC responses containing scientific/user data"). Every
// rule below is scoped narrowly and explicitly to content that is either
// build-content-hashed or deliberately public, so each one can be audited
// on its own. Anything not matched here (Supabase Auth, Server Actions,
// /api/offline-sync, R analytics requests, admin data, signed Plant Media
// URLs, every other authenticated page) falls through to the explicit
// terminal NetworkOnly rule - no interception, no caching, same as if the
// service worker were not installed at all. POST requests (Server Actions,
// the offline-sync endpoint) are never matched by any rule below since none
// declare `method`, which scopes Workbox routing to GET only; POSTs always
// pass straight through to the network.
const runtimeCaching: RuntimeCaching[] = [
  // Next.js build output under /_next/static/** is content-hashed by the
  // build itself (a changed file gets a new URL), so caching it forever is
  // safe - a stale entry simply stops being referenced by the next build's
  // HTML/RSC output rather than being served stale.
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "breedops-next-static",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 128,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    }),
  },
  // PWA manifest + installable icons (public/icons/*): small, same-origin,
  // not scientific data. Stale-while-revalidate so an icon/manifest update
  // propagates on the next visit without blocking it.
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin &&
      (pathname === "/manifest.webmanifest" || pathname.startsWith("/icons/")),
    handler: new StaleWhileRevalidate({
      cacheName: "breedops-pwa-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 16,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    }),
  },
  // Page navigations: never cache the response itself (it may be
  // authenticated, user- or program-scoped HTML/RSC). NetworkOnly here
  // exists only so a failed navigation has a strategy whose
  // handlerDidError the fallback below can hook into - see the
  // `fallbacks` option passed to the Serwist constructor.
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkOnly(),
  },
  // Explicit terminal rule: anything else gets no interception and no
  // cache, stated here rather than left as an implicit non-match so the
  // "never cached" set is as auditable as the "cached" set above.
  {
    matcher: () => true,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Deliberately NOT skipWaiting: true (V2-07 §27 - "never force an
  // update/reload that could discard an in-progress offline form"). A new
  // service worker installs and then WAITS; it only takes over once the
  // page explicitly asks it to (the "SKIP_WAITING" message handler below),
  // which src/lib/offline/sw-update.ts only ever sends in response to the
  // user clicking the update prompt themselves.
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  // /offline is precached (next.config.mjs additionalPrecacheEntries) and
  // deliberately unauthenticated/static (src/app/offline/page.tsx), so it
  // is always safe to serve as the navigation fallback - this is what
  // turns an offline navigation into BreedOps's own offline page (V2-07
  // §28) instead of the browser's generic network-error page.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();

// Background Sync (V2-07 §20): a pure progressive enhancement. The actual
// outbox-flush logic lives entirely in the page (src/lib/offline/sync.ts),
// which also drives sync from app startup/resume, the manual "Synchroniser
// maintenant" button and the browser `online` event - all of which work
// identically with no Background Sync support at all. This listener only
// forwards the browser's sync opportunity to any open client so that
// client-side logic can run; if no client is open, or the browser does not
// support Background Sync, nothing here is required for durability or
// eventual sync.
// Service-worker update safety (V2-07 §27): the page-side update prompt
// (src/lib/offline/sw-update.ts) sends this only after the user has
// explicitly chosen to update - never automatically.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("sync", (event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== "breedops-offline-outbox") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "breedops-background-sync" });
        }
      }),
  );
});
