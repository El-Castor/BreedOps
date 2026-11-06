import { FieldWorkspace } from "./field-workspace";

// Dedicated offline-safe field workspace (V2-07 §6). Deliberately a
// top-level route outside /app: unlike every other authenticated screen in
// BreedOps, this page is precached by the service worker (see
// src/app/sw.ts, next.config.mjs's additionalPrecacheEntries) and must be
// able to render with zero network access, so it cannot sit behind the
// server-rendered /app layout or middleware's live Supabase session check
// (src/middleware.ts only gates /app/:path*). Identity and scientific data
// for this workspace come from IndexedDB offline packs prepared earlier
// while online (see /app/field-packs), never from a fresh server fetch -
// FieldWorkspace resolves which profile's packs to show entirely
// client-side (URL ?profile=, then a remembered value, then whatever is
// already in IndexedDB).
export default function FieldWorkspacePage() {
  return (
    <main className="offline-shell field-shell">
      <div className="field-container">
        <h1>Espace terrain</h1>
        <FieldWorkspace initialProfileId={null} />
      </div>
    </main>
  );
}
