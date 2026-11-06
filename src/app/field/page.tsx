"use client";

// Dedicated offline-safe field workspace (V2-07 §6). Deliberately a
// top-level route outside /app: unlike every other authenticated screen in
// BreedOps, this page is precached by the service worker (see
// src/app/sw.ts, next.config.mjs's additionalPrecacheEntries) and must be
// able to render with zero network access, so it cannot sit behind the
// server-rendered /app layout or middleware's live Supabase session check
// (src/middleware.ts only gates /app/:path*). Identity and scientific data
// for this workspace come from IndexedDB offline packs prepared earlier
// while online (see /app/field-packs), never from a fresh server fetch.
//
// This is the first V2-07 skeleton of the route so the service worker has
// something real to precache; the IndexedDB-backed pack picker, phenotype
// entry form, outbox and sync status (spec §6-§23) are built out next.
export default function FieldWorkspacePage() {
  return (
    <main className="offline-shell">
      <div className="card offline-card">
        <h1>Espace terrain</h1>
        <p>
          Cet espace permet de saisir des phénotypes sur un essai préparé pour
          le travail hors ligne, et reste utilisable sans connexion réseau.
        </p>
      </div>
    </main>
  );
}
