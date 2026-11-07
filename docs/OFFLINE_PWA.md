# Offline Mode & PWA (V2-07)

Scope, architecture, and the exact trust model for BreedOps's offline field
capture. This document is the companion to `src/app/sw.ts`,
`src/lib/offline/*`, `src/app/field/*`, `src/app/app/field-packs/*`,
`src/app/api/offline-sync/route.ts`, and migration `000035`.

## 1. The core objective

V2-07 does **not** make the whole server application work offline. It makes
one specific, scoped workflow durable without a network connection: a
breeder prepares a trial while online, captures phenotype evaluations in the
field with no connectivity, and those observations synchronize safely and
**exactly once** when connectivity returns. PostgreSQL/Supabase remains the
single authoritative database at all times; the browser's IndexedDB store is
never an independent copy of BreedOps, only a scoped, user-owned local
queue and reference cache.

```
PostgreSQL/Supabase  ←  authenticated, idempotent sync  ←  Next.js server
        ↑                                                       ↑
        |                                          offline sync protocol
        |                                                       ↑
        └──────────────────────────────────  IndexedDB (packs, outbox, sync state)
                                                                  ↑
                                                         BreedOps PWA (browser)
```

## 2. PWA installation

- `src/app/manifest.ts` — the native Next.js App Router manifest
  (served at `/manifest.webmanifest`). `name`/`short_name` "BreedOps",
  `start_url: "/app"`, `display: "standalone"`, theme/background colors
  taken from the existing design tokens (`--primary`, `--canvas`).
- `public/icons/` — installable icons rasterized from the app's existing
  lucide "Leaf" brand mark (never a second brand identity): `icon-192.png`,
  `icon-512.png`, maskable variants with safe-zone padding
  (`icon-maskable-*.png`), and `apple-touch-icon.png` for iOS. The source
  SVGs (`icon.svg`, `icon-maskable.svg`) are checked in; the PNGs were
  rasterized once via a headless-Chromium screenshot (ImageMagick's SVG
  delegate is unavailable in this project's environments) and are also
  checked in as static assets.
- `src/app/layout.tsx` sets `appleWebApp: { capable: true, ... }` and links
  the manifest/icons, covering iOS's non-standard metadata needs.

## 3. Service worker and cache policy

`src/app/sw.ts`, built via `@serwist/next` (`next.config.mjs`'s
`withSerwist`), pinned at `@serwist/next`/`serwist`/`idb` exact versions in
`package.json`. **Disabled outside production builds**
(`disable: process.env.NODE_ENV !== "production"`) — dev-mode service-worker
behavior is not representative and would otherwise fight Next's dev/HMR
pipeline; the release gate (§17) always tests the production build.

The runtime-caching policy is deliberately **not**
`@serwist/next/worker`'s `defaultCache` — that default puts authenticated
same-origin HTML, RSC payloads and `GET /api/*` responses into a 24h
`NetworkFirst` cache, which is exactly what this milestone forbids. Every
rule in `src/app/sw.ts` is scoped narrowly enough to audit on its own:

| Resource | Strategy | Why |
| --- | --- | --- |
| `/_next/static/**` | `CacheFirst` | Content-hashed by the build; a stale entry simply stops being referenced. |
| `/manifest.webmanifest`, `/icons/*` | `StaleWhileRevalidate` | Small, public, not scientific data. |
| Navigations (`request.mode === "navigate"`) | `NetworkOnly` + precached `/offline` fallback | The response itself is never cached (may be authenticated/program-scoped); a failed navigation falls back to the precached, deliberately unauthenticated `/offline` page instead of the browser's generic error. |
| Everything else (Supabase Auth, Server Actions, `/api/offline-sync`, R analytics, admin data, signed Plant Media URLs, every other authenticated page) | **No interception** (explicit terminal `NetworkOnly` rule) | Same as if no service worker were installed. POST requests (Server Actions, the sync endpoint) are never matched by any rule since none declare `method`, which scopes Workbox routing to GET only. |

`/offline` and `/field` are explicitly precached
(`next.config.mjs`'s `additionalPrecacheEntries`, stamped with a per-build
revision so a new deploy invalidates the previous build's copy) because
they are the two routes that must render with zero network access. Both are
deliberately **top-level routes outside `/app`**, so neither the
server-rendered `/app` layout nor `src/middleware.ts`'s live Supabase
session check (matcher: `/app/:path*`) ever gates them — a live session
check cannot succeed offline by definition.

## 4. IndexedDB schema

`src/lib/offline/db.ts`, via the pinned `idb` wrapper. Database
`breedops-offline`, currently schema version `1`. Three stores:

- **`packs`** (key `packId`, index `byProfile`) — one row per prepared
  offline pack (§5).
- **`outbox`** (key `operationId`, indexes `byPack`/`byStatus`/`byProfile`)
  — the local operation queue (§7).
- **`syncState`** (key `packId`) — per-pack `lastSyncAttemptAt`/
  `lastSyncSuccessAt`/`isSyncing` bookkeeping for the pack management
  screen.

Upgrades use the additive `if (oldVersion < N)` pattern inside `db.ts`'s
`upgrade()` callback, so a future schema change never drops existing data.
`tests/offline-db.test.ts` includes a dedicated version-upgrade test (open
v1, write data, open v2 with a new store/index, confirm both the old data
and the new store survive) exercising the same `idb` mechanics the real
schema depends on.

## 5. The offline pack lifecycle

A pack is **never** downloaded implicitly. From `/app/field-packs`
(authenticated, online), a user explicitly clicks "Rendre disponible hors
ligne" for one trial. `buildFieldOfflinePack()`
(`src/app/app/field-packs/actions.ts`, a server action) is a read-only,
RLS-scoped query: the trial's phenotypes (joined to their trial entries and
environments), and the program's active traits
(`program_active_traits()`, 000016). It hands these to the pure
`buildOfflinePack()` (`src/lib/offline/pack-builder.ts`), which assembles
the pack record:

```ts
{
  packId: "<profileId>:<trialId>",   // user-scoped, never collides across users
  schemaVersion, profileId, organizationId, programId, trialId,
  programCode, programName, trialCode, trialName,
  entries: [{ phenotypeId, phenotypeCode, label, qr }],
  activeTraits: [...],               // full trait config needed to validate/render the form
  configFingerprint,                 // see §10
  snapshotCreatedAt,
}
```

Only what the field workflow actually needs is captured — never a full
analytics history, never other programs. The client then persists this
object via `putPack()`; nothing is written server-side by the build step
itself.

**Refresh** re-runs the same action and overwrites the pack record, but
never touches the `outbox` store — a refresh can never silently discard
queued evaluations. **Remove** (`deletePackRecord()`) also never cascades to
the outbox; the pack-management UI (`field-pack-card.tsx`) blocks deletion
behind an extra, explicit confirmation step whenever the pack still has
unsynchronized operations, stating the data-loss risk in the confirmation
copy itself rather than deleting silently.

## 6. Offline-supported vs. online-only operations

The only offline-capable write in V1 is `PHENOTYPE_TRAIT_EVALUATION`,
matching `submit_trait_evaluation()`'s own semantics exactly (phenotype,
evaluation date, typed trait values, notes). Everything else — trait
definitions, selection models, program/trial configuration, user
administration, imports, archive/delete, MET analytics, MGIDI/MTSI, R
calculations, breeding-decision configuration — stays online-only. The
offline workspace may display already-cached reference data for these
(e.g. the pack's own trait list), but can never mutate them.

## 7. The field workspace

`src/app/field/` (`field-workspace.tsx`): a detached client component,
reachable at the precached `/field` URL. Since it must render with zero
network access, it resolves **which profile's packs to show entirely
client-side** — never from a fresh server fetch:

1. A `?profile=` URL query parameter, if present (kept as an optional
   capability, not the default link target — see the note in §12).
2. A value remembered in `localStorage["breedops-offline-active-profile"]`,
   written by `OfflineIndicator` (`src/components/app-shell.tsx`) on every
   authenticated `/app/*` page, and by the field workspace itself whenever
   it resolves a profile.
3. Whichever profile already has packs in IndexedDB (`listAllPacks()`),
   as a last resort.

Within the workspace: a pack/trial picker (auto-selected when there is only
one), a text search over the pack's cached phenotype entries by code or
label, **local QR resolution** (§8), and a per-trait evaluation form
rendered from the pack's own `activeTraits` — numeric/integer/ordinal as a
bounds-checked number input, boolean as a checkbox, date as a date input,
categorical as a constrained select, everything else as bounded free text.
`src/lib/offline/trait-validation.ts` mirrors `submit_trait_evaluation()`'s
own per-type rules for immediate feedback; this is explicitly **UX only**
— the server always re-validates unconditionally at sync time regardless
of what the client agreed or disagreed with.

## 8. Local QR resolution

`src/lib/offline/qr-resolve.ts` reuses the existing V2-01 QR deep-link
format (`/app/lookup?type=<entity type>&id=<uuid>`,
`src/lib/qr/payload.ts`) — never a second, incompatible format, and never a
new in-app scanner (BreedOps has none, online or offline). The supported
flow is the phone's own camera app decoding a physical label; the user
pastes the resulting link (or its bare path/query) into the field
workspace. `parseQrInput()` validates it with the same
`isQrEntityType()`/`isUuid()` checks the online resolver uses;
`resolvePhenotypesByQr()` matches it purely locally against the
seed-lot/family/parent-line association each pack entry already carries
(captured at pack-build time, most-specific-first) — never a network call.

## 9. The local operation envelope and outbox

`src/lib/offline/outbox.ts`'s `buildPhenotypeEvaluationOperation()` turns a
saved field-entry form into an immutable
`OfflineOutboxOperation`: a client-generated `operationId`
(`crypto.randomUUID()`), the payload, a canonical `payloadHash`
(`src/lib/offline/payload-hash.ts`, Web Crypto SHA-256 over a
key-order-independent JSON canonicalization — identical client- and
server-side), the pack's `configurationFingerprint` carried along for the
sync-time `CONFIG_CHANGED` check, and a status. There is a single
"Enregistrer" action that both saves and queues an evaluation — no separate
draft step in V1, so nothing currently produces the `DRAFT` status (kept
reserved in the type for a possible future autosave feature).

State machine (`DRAFT → PENDING → SYNCING → SYNCED | CONFLICT | FAILED`),
transitioned only through the pure helpers in `outbox.ts`
(`markSyncing`/`markSynced`/`markConflict`/`markFailed`/
`markPendingRetry`). `markConflict` and `markFailed` never touch the
stored `payload` — the local observation is always retained verbatim; a
conflict is never auto-resolved, only reviewed, retried, or explicitly
discarded by the user (never silently, always behind a confirmation step
in the outbox UI).

## 10. Synchronization protocol

`src/lib/offline/sync.ts`'s `syncPendingOperations(profileId)` is the
entire durability story. It batches every `PENDING` operation for the
profile into groups of 25 (matching the server's own bound), marks each
`SYNCING`, and POSTs the batch to `/api/offline-sync`. **Foreground
triggers** (V2-07 §19), all calling this same function: app
startup/resume (once a profile's packs load), the browser `online` event,
a manual "Synchroniser maintenant" button shown whenever there is a
backlog, and immediately after saving a new evaluation if already online.

**Background Sync** (`registerBackgroundSync()`, the `sync` event listener
in `src/app/sw.ts`) is a pure progressive enhancement: where supported, it
asks the browser for a sync opportunity and the service worker forwards it
to the page via `postMessage`, which just calls
`syncPendingOperations()` again. Nothing about correctness or eventual
delivery depends on the browser supporting it — the three foreground
triggers above are sufficient on their own, and CI never special-cases
Background Sync support.

A `RETRYABLE_SERVER_ERROR` or a network-level failure marks the operation
`FAILED` and schedules an automatic retry with **bounded exponential
backoff** (`2^attemptCount` seconds, capped at 60s) — requeued as `PENDING`
and re-attempted if still online when the timer fires. A business
`CONFLICT` (anything else in §11) is **never** auto-retried this way.

## 11. Idempotency and the conflict/error taxonomy

Migration `000035_offline_sync_idempotency.sql` adds
`offline_sync_receipts` (an append-only ledger — RLS grants same-org
`SELECT` only, no `UPDATE`/`DELETE` policy exists for `authenticated` at
all) and `submit_offline_phenotype_evaluation()`, the **only** path the
sync endpoint may use to create an evaluation from a queued operation.

Inside one transaction, serialized per `operation_id` via
`pg_advisory_xact_lock` (so two concurrent retries of the same operation
can never both insert before either commits):

1. If a receipt for this `operation_id` already exists with a **matching**
   `payload_hash` → return the existing `evaluation_id` (`replay: true`),
   calling `submit_trait_evaluation()` again. This is the exact-once
   guarantee: a network retry, an HTTP timeout after the server already
   committed, or the app being closed and reopened before the ack arrived
   can never create a second observation.
2. If a receipt exists with a **different** `payload_hash` → reject
   outright with `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` (mapped to
   the client-facing `IDEMPOTENCY_PAYLOAD_MISMATCH` code) — an
   `operation_id` reused for different content is never silently accepted.
3. Otherwise, re-derive `program_id` from `phenotype_id` itself — **never**
   a client-asserted scope — distinguish `TARGET_NOT_FOUND` from
   `TARGET_ARCHIVED` (`phenotypes.deleted_at IS NOT NULL`, the only
   archival concept `phenotypes` currently has), check
   `PERMISSION_REVOKED` via `can_write_program()`, then delegate
   unconditionally to the existing `submit_trait_evaluation()` (000016) —
   never a divergent validation copy. Any failure there is caught and
   re-raised as `VALIDATION_REJECTED: <message>`; the implicit savepoint
   this creates rolls back any partial insert, so a rejected evaluation
   never leaves a half-written row behind.

`src/app/api/offline-sync/route.ts` is the narrow, authenticated endpoint
(`resolveIdentity()` via the caller's own session cookie — the
service-role key is never touched here). Before calling the RPC for each
operation, it recomputes the program's **current** active-trait
configuration fingerprint (`src/lib/offline/active-traits.ts`, shared with
the pack-build action so the two can never independently drift) and
compares it to the one the operation was queued against; a mismatch
returns `CONFIG_CHANGED` without ever calling the RPC. Every RPC error is
mapped from its structured message prefix to one of the exact result
codes; an unrecognized failure defaults to `RETRYABLE_SERVER_ERROR` rather
than ever being collapsed into a generic "sync failed":

| Code | Meaning |
| --- | --- |
| `SYNCED` | Committed (fresh or replayed). |
| `AUTH_REQUIRED` | No valid session at all — checked before any operation is even read; the queue is never touched, never discarded. |
| `PERMISSION_REVOKED` | Caller can no longer write to the target program. |
| `TARGET_NOT_FOUND` | The phenotype no longer exists. |
| `TARGET_ARCHIVED` | The phenotype is soft-deleted. |
| `CONFIG_CHANGED` | Active-trait configuration differs from the pack's fingerprint. |
| `VALIDATION_REJECTED` | `submit_trait_evaluation()`'s own rule rejected the value. |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` | Same `operation_id`, different content. |
| `RETRYABLE_SERVER_ERROR` | Anything else — eligible for automatic backoff retry. |

The request is Zod-validated and bounded (512 KB, 25 operations, 200 trait
values per operation) and accepts only the one allowlisted operation type.

## 12. Storage durability

`src/lib/offline/storage-status.ts` wraps `navigator.storage.estimate()`/
`persisted()`/`persist()`. **Persistence is never claimed beyond what the
browser actually returns** — a denial is never treated as an error, and
offline functionality keeps working regardless. `StorageStatusPanel`
(`/app/field-packs`, shown once since storage is origin-wide, not
per-pack) shows the current usage/quota estimate and a clear "Stockage
persistant accordé" vs. "Stockage au mieux" distinction, with a request
button only when persistence has not already been granted.

## 13. Logout and the local-data security model

Offline data is strictly user-scoped: **user A's pack must never be
reachable by user B.** `src/components/logout-guard.tsx`'s `LogoutForm`
replaces the plain logout form: it checks
`countUnsyncedOperationsForProfile()` for the current profile before
letting the real `/auth/logout` POST through.

- **Zero pending/conflicted operations**: clears this profile's IndexedDB
  data **and** the remembered-active-profile `localStorage` key together
  (`clearProfileEverywhere()`) before submitting. Clearing both matters —
  leaving the `localStorage` key behind would let `/field` silently pick
  the previous user's (by-then-empty) profile back up the moment a
  different user logs in on the same device without first visiting an
  authenticated `/app` page.
- **Any pending/conflicted operations**: blocks by default, states the
  count, and offers "Retour pour synchroniser" (cancel) or an explicit,
  second-confirmation "Se déconnecter sans synchroniser" escape hatch that
  states the data loss plainly before it happens. Nothing is ever erased
  silently.

**Trust model** (V1): IndexedDB is **not** application-level encrypted
storage — it relies entirely on browser-origin isolation and OS/browser
profile security. No service-role secrets and **no auth tokens** are ever
written to IndexedDB (the offline store only ever holds packs, outbox
operations, and sync-state bookkeeping; the Supabase session itself lives
in an `HttpOnly` cookie, as it always has). Browser storage can be cleared
by the user or evicted by the browser outside of `persist()`. An untrusted
or shared browser profile is not an appropriate place to prepare
confidential offline experimental data — the only mitigation is the
explicit, confirmed "Clear offline data" path above; there is no
server-side way to revoke already-downloaded local data.

A session can expire while the device is offline. `AUTH_REQUIRED` from the
sync endpoint **never discards the queue** — operations stay exactly
`PENDING`, and the field workspace shows a banner linking to `/login`.
Re-authenticating lets the next sync pass resume with no special "resume"
step. The queue is never sent through a different logged-in user's
session: the server always derives the acting identity from the request's
own session cookie, never from any client-supplied field.

## 14. Service worker update safety

`skipWaiting` is deliberately **not** set — Serwist's default is `false`,
so a new service worker installs and sits `waiting` rather than taking
over automatically. `src/lib/offline/sw-update.ts` watches the existing
registration (it never calls `register()` itself; `@serwist/next`'s
webpack plugin already does that) for a worker in `waiting`.
`ServiceWorkerUpdateBanner` (mounted once in the root layout, so it covers
every route including `/field` and `/offline`) shows "Une nouvelle version
de BreedOps est disponible" only once a worker is genuinely waiting, with
an explicit "Mettre à jour maintenant" (posts `SKIP_WAITING` to the
waiting worker via the message listener in `src/app/sw.ts`, then reloads
once it actually takes control) or "Plus tard" (dismiss). **The reload is
always the user's own choice, on their own timing** — it is never forced,
so it never discards an in-progress offline form on its own. Old-cache
cleanup during activation is handled by Serwist's own precache controller.

## 15. Browser limitations and known gaps

- **No offline analytics**: R/sommer/metan/MGIDI/MTSI remain entirely
  online-only; nothing is ported to WASM. The offline workspace may show
  cached reference labels but never fabricates a locally computed
  authoritative analysis.
- **No offline media upload** (`OFFLINE_MEDIA_UPLOAD = DEFERRED`):
  deliberately out of this milestone's scope, given browser storage
  quota/eviction risk, large-blob handling, upload-resume semantics, and
  Supabase Storage consistency — scientific observation sync correctness
  was prioritized over photo support.
- **Background Sync support varies by browser** (notably: not Safari/iOS
  as of this writing) — by design this only ever changes *how promptly* a
  queued operation syncs, never *whether* it eventually can, since the
  three foreground triggers cover every browser unconditionally.
- Clearing site data, using a private/incognito window, or the browser
  evicting storage under pressure (when persistence was not granted) can
  remove the local queue before it syncs — this is the same
  `navigator.storage.persist()` trade-off every PWA faces, communicated
  honestly in the storage status panel (§12) rather than hidden.

## 16. Troubleshooting / recovery

- **"My evaluations disappeared after a reload"**: IndexedDB survives a
  normal reload, browser restart, and app close/reopen. If genuinely
  empty, check whether site data was cleared (browser settings) or
  whether a *different* profile is now active (§13) — packs and outbox
  entries are strictly per-profile and intentionally invisible to another
  user on the same device.
- **"It says I have pending evaluations but I'm online"**: open
  `/app/field-packs` or `/field` and use "Synchroniser maintenant"; check
  for a session-expiry banner (§13) requiring re-login, or an outbox entry
  marked `CONFLICT` (§11) that needs explicit review rather than a plain
  retry.
- **"A new deploy and my queue vanished"**: this should never happen —
  deploying a new service worker version never clears IndexedDB (only an
  explicit "Clear offline data" action or browser-level storage eviction
  does). If observed, treat it as a regression, not expected behavior.
- **Developer**: `npm run build && npm run start`, then use actual
  browser DevTools → Application → Service Workers / IndexedDB, or
  Playwright's `context.setOffline()` (see `e2e/offline-field.spec.ts`)
  — development mode (`npm run dev`) never installs the service worker at
  all (§3), so it cannot be used to reproduce an offline-specific issue.

## 17. Testing

- **Unit** (`tests/offline-*.test.ts`, `fake-indexeddb` where IndexedDB is
  exercised): pack building, the outbox envelope and its status
  transitions, trait validation, the config-fingerprint/payload-hash
  determinism properties, the sync engine's result-code handling (mocked
  `fetch`), QR parsing/resolution, storage-status fallbacks, a dedicated
  IndexedDB schema-upgrade test.
- **pgTap** (`tests/offline-sync.sql`, `npm run test:offline-sync`): the
  exact-once retry, the payload-mismatch rejection, every structured
  error code, and that the receipt table cannot be mutated by the
  application role.
- **Integration** (`tests/offline-sync.integration.test.ts`, real HTTP
  against a running build): the same guarantees end to end through the
  actual route, plus the 401/`AUTH_REQUIRED` and bounded-batch-size paths.
- **E2E** (`e2e/offline-field.spec.ts`, release-blocking): the full real
  browser offline/online flow against the production build and its real
  service worker — prepare, go offline, capture, reload while offline,
  reconnect, synchronize, verify exactly one server record per operation —
  plus the offline-fallback and manifest checks.
  `e2e/responsive-smoke.spec.ts`/`accessibility-smoke.spec.ts` cover
  `/app/field-packs`, `/field` and `/offline` at the same width matrix and
  axe-core pass as the rest of the app.

## 18. Out of scope for V2-07

Native iOS/Android apps, Electron, full database replication, offline R
analytics, offline administration, offline destructive archive/delete,
GBLUP/genomic features, new analytics methods, automatic mating
optimization, a new in-app QR scanner. The goal is reliable scientific
field capture, not a second platform.
