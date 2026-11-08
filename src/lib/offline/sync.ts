import {
  getOperation,
  getSyncState,
  listOperationsForProfile,
  putOperation,
  putSyncState,
} from "./db";
import {
  markConflict,
  markFailed,
  markPendingRetry,
  markSynced,
  markSyncing,
} from "./outbox";
import type { OfflineOutboxOperation, OfflineSyncResultCode } from "./types";

// The foreground sync state machine (V2-07 §19): triggered from app
// startup/resume, the manual "Synchroniser maintenant" action, and the
// browser `online` event - all three call syncPendingOperations() below,
// which is the entire durability story. Background Sync (src/app/sw.ts's
// `sync` event listener, registerBackgroundSync() here) is wired on top as
// a pure progressive enhancement: it only ever calls this same function
// via a postMessage from the service worker, so nothing about correctness
// or eventual delivery depends on the browser supporting it (§20).

const MAX_OPERATIONS_PER_BATCH = 25;
// The server's own bound (src/app/api/offline-sync/route.ts) - batching to
// the same size avoids ever sending a request the server would reject for
// size alone.

export interface SyncSummary {
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
  authRequired: boolean;
}

interface WireOperation {
  operationId: string;
  operationType: string;
  programId: string;
  phenotypeId: string;
  evaluationDate: string;
  values: Record<string, string | number | boolean>;
  notes: string | null;
  payloadHash: string;
  packConfigurationFingerprint: string;
}

function toWireOperation(op: OfflineOutboxOperation): WireOperation {
  return {
    operationId: op.operationId,
    operationType: op.operationType,
    programId: op.programId,
    phenotypeId: op.payload.phenotypeId,
    evaluationDate: op.payload.evaluationDate,
    values: op.payload.values,
    notes: op.payload.notes,
    payloadHash: op.payloadHash,
    packConfigurationFingerprint: op.packConfigurationFingerprint,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** Bounded exponential backoff, capped at 60s, for a FAILED (retryable)
 * operation - never applied to CONFLICT, which is a business outcome the
 * user must act on, not a transient failure (§17, §19: "do not infinitely
 * retry business conflicts"). */
function backoffDelayMs(attemptCount: number): number {
  return Math.min(2 ** attemptCount * 2000, 60_000);
}

interface ScheduledRetry {
  attemptCount: number;
  timer: ReturnType<typeof setTimeout>;
}

const scheduledRetries = new Map<string, ScheduledRetry>();

function remainingBackoffMs(op: OfflineOutboxOperation): number {
  if (!op.lastAttemptAt) return 0;
  const attemptedAt = Date.parse(op.lastAttemptAt);
  if (!Number.isFinite(attemptedAt)) return 0;
  const dueAt = attemptedAt + backoffDelayMs(op.attemptCount);
  return Math.max(0, dueAt - Date.now());
}

/**
 * Requeues a retry only if IndexedDB still contains the exact FAILED
 * attempt that originally scheduled it. This prevents an old in-memory
 * timer from overwriting a newer SYNCED/CONFLICT/PENDING state.
 */
async function requeueFailedAttemptIfCurrent(
  operationId: string,
  attemptCount: number,
  profileId: string,
): Promise<boolean> {
  const current = await getOperation(operationId);
  if (
    !current ||
    current.profileId !== profileId ||
    current.status !== "FAILED" ||
    current.attemptCount !== attemptCount
  ) {
    return false;
  }

  await putOperation(markPendingRetry(current));
  return true;
}

function scheduleRetry(op: OfflineOutboxOperation, profileId: string) {
  const existing = scheduledRetries.get(op.operationId);

  if (existing?.attemptCount === op.attemptCount) return;

  if (existing) clearTimeout(existing.timer);

  const attemptCount = op.attemptCount;
  const timer = setTimeout(() => {
    scheduledRetries.delete(op.operationId);

    void (async () => {
      const requeued = await requeueFailedAttemptIfCurrent(
        op.operationId,
        attemptCount,
        profileId,
      );

      if (requeued && typeof navigator !== "undefined" && navigator.onLine) {
        await syncPendingOperations(profileId);
      }
    })();
  }, remainingBackoffMs(op));

  scheduledRetries.set(op.operationId, { attemptCount, timer });
}

/**
 * Makes the retry state durable across a page/browser restart.
 *
 * FAILED rows are persisted in IndexedDB. On the next foreground sync:
 * - if their persisted backoff has expired, they are requeued immediately;
 * - otherwise a new timer is scheduled for the remaining delay.
 *
 * SYNCING is transient by definition. Any SYNCING row found when a new
 * sync pass starts without an in-flight pass in this JavaScript context
 * is treated as an interrupted previous attempt and returned to PENDING.
 * Server-side idempotency makes resending that operation safe even if the
 * previous request committed before the client disappeared.
 */
async function recoverPersistedOperations(
  profileId: string,
): Promise<OfflineOutboxOperation[]> {
  const stored = await listOperationsForProfile(profileId);
  const recoveredPackIds = new Set<string>();

  for (const op of stored) {
    if (op.status === "SYNCING") {
      await putOperation(markPendingRetry(op));
      recoveredPackIds.add(op.packId);
      continue;
    }

    if (op.status !== "FAILED") continue;

    recoveredPackIds.add(op.packId);
    const remaining = remainingBackoffMs(op);

    if (remaining === 0) {
      await requeueFailedAttemptIfCurrent(
        op.operationId,
        op.attemptCount,
        profileId,
      );
    } else {
      scheduleRetry(op, profileId);
    }
  }

  // A page/browser crash can leave the per-pack UI bookkeeping stuck at
  // isSyncing=true. Once persisted FAILED/SYNCING rows are recovered there
  // is no live request owned by this page context yet, so clear that stale
  // indicator while preserving both timestamps. If a recovered PENDING row
  // is sent below, the normal sync pass immediately sets isSyncing=true
  // again before the request starts.
  for (const packId of recoveredPackIds) {
    const state = await getSyncState(packId);
    if (state?.isSyncing) {
      await putSyncState({
        ...state,
        isSyncing: false,
      });
    }
  }

  return listOperationsForProfile(profileId);
}

/** Sends every eligible operation for a profile to /api/offline-sync,
 * batched to the server's own bound, and applies the resulting status
 * transitions. Persisted SYNCING rows from an interrupted previous page
 * context are deliberately recovered to PENDING before selection; SYNCED
 * and CONFLICT remain terminal for automatic synchronization. */
async function runSyncPendingOperations(
  profileId: string,
): Promise<SyncSummary> {
  const all = await recoverPersistedOperations(profileId);
  const pending = all.filter((op) => op.status === "PENDING");
  const summary: SyncSummary = {
    attempted: pending.length,
    synced: 0,
    conflicts: 0,
    failed: 0,
    authRequired: false,
  };
  if (pending.length === 0) return summary;

  const touchedPacks = new Set(pending.map((op) => op.packId));
  for (const packId of touchedPacks) {
    const state = await getSyncState(packId);
    await putSyncState({
      packId,
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncSuccessAt: state?.lastSyncSuccessAt ?? null,
      isSyncing: true,
    });
  }

  for (const batch of chunk(pending, MAX_OPERATIONS_PER_BATCH)) {
    const syncing = new Map(
      batch.map((op) => [op.operationId, markSyncing(op)] as const),
    );
    await Promise.all([...syncing.values()].map((op) => putOperation(op)));

    let response: Response;
    try {
      response = await fetch("/api/offline-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: batch.map((op) => toWireOperation(op)),
        }),
      });
    } catch {
      // Network failure: every operation in this batch is retryable.
      for (const op of syncing.values()) {
        const failedOp = markFailed(op, "Connexion réseau indisponible.");
        await putOperation(failedOp);
        scheduleRetry(failedOp, profileId);
      }
      summary.failed += batch.length;
      continue;
    }

    if (response.status === 401) {
      summary.authRequired = true;
      // Never discard the queue on AUTH_REQUIRED (§26) - operations stay
      // PENDING exactly as they were so the same sync pass can pick them
      // up again right after the user re-authenticates, with no special
      // "resume" step required.
      for (const op of batch) await putOperation(op);
      continue;
    }

    if (!response.ok) {
      for (const op of syncing.values()) {
        const failedOp = markFailed(
          op,
          `Erreur serveur inattendue (HTTP ${response.status}).`,
        );
        await putOperation(failedOp);
        scheduleRetry(failedOp, profileId);
      }
      summary.failed += batch.length;
      continue;
    }

    const body = (await response.json()) as {
      results: {
        operationId: string;
        resultCode: OfflineSyncResultCode;
        evaluationId?: string;
        message: string;
      }[];
    };
    for (const result of body.results) {
      const op = syncing.get(result.operationId);
      if (!op) continue;
      if (result.resultCode === "SYNCED" && result.evaluationId) {
        await putOperation(markSynced(op, result.evaluationId));
        summary.synced += 1;
      } else if (result.resultCode === "RETRYABLE_SERVER_ERROR") {
        const failedOp = markFailed(op, result.message);
        await putOperation(failedOp);
        scheduleRetry(failedOp, profileId);
        summary.failed += 1;
      } else {
        await putOperation(markConflict(op, result.resultCode, result.message));
        summary.conflicts += 1;
      }
    }
  }

  for (const packId of touchedPacks) {
    const state = await getSyncState(packId);
    const stillUnsynchronized = (
      await listOperationsForProfile(profileId)
    ).some((op) => op.packId === packId && op.status !== "SYNCED");

    await putSyncState({
      packId,
      lastSyncAttemptAt: state?.lastSyncAttemptAt ?? new Date().toISOString(),
      lastSyncSuccessAt: stillUnsynchronized
        ? state?.lastSyncSuccessAt ?? null
        : new Date().toISOString(),
      isSyncing: false,
    });
  }

  return summary;
}

const inFlightSyncs = new Map<string, Promise<SyncSummary>>();
const rerunRequested = new Set<string>();

/**
 * Serializes sync triggers for one profile inside this page context.
 *
 * If startup, online, manual sync, a retry timer or the service-worker
 * message fires while a pass is already running, the caller joins that
 * pass and requests one coalesced follow-up pass. This matters when the
 * first pass has already selected its PENDING rows and a retry timer
 * persists another PENDING operation while the request is in flight.
 */
export function syncPendingOperations(profileId: string): Promise<SyncSummary> {
  const existing = inFlightSyncs.get(profileId);

  if (existing) {
    rerunRequested.add(profileId);
    return existing;
  }

  const running = (async () => {
    const total: SyncSummary = {
      attempted: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      authRequired: false,
    };

    do {
      rerunRequested.delete(profileId);

      const pass = await runSyncPendingOperations(profileId);

      total.attempted += pass.attempted;
      total.synced += pass.synced;
      total.conflicts += pass.conflicts;
      total.failed += pass.failed;
      total.authRequired ||= pass.authRequired;

      // Repeating immediately cannot repair an expired authentication
      // session. Keep the durable queue intact and wait for re-authentication
      // to provide the next meaningful trigger.
      if (pass.authRequired) {
        rerunRequested.delete(profileId);
        break;
      }
    } while (rerunRequested.has(profileId));

    return total;
  })().finally(() => {
    if (inFlightSyncs.get(profileId) === running) {
      inFlightSyncs.delete(profileId);
    }
  });

  inFlightSyncs.set(profileId, running);
  return running;
}

/** Progressive enhancement only (V2-07 §20): registers a Background Sync
 * event with the service worker when the browser supports it, so a sync
 * opportunity can be seized even if the tab isn't in the foreground at the
 * moment connectivity returns. Every caller must also wire the three
 * mandatory foreground triggers (startup, manual button, `online` event)
 * themselves - this function is never required for correctness. */
export async function registerBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const syncRegistration = registration as ServiceWorkerRegistration & {
    sync?: { register: (tag: string) => Promise<void> };
  };
  if (!syncRegistration.sync) return;
  try {
    await syncRegistration.sync.register("breedops-offline-outbox");
  } catch {
    /* Background Sync registration failing is never fatal - the three
     * foreground triggers remain fully functional on their own. */
  }
}

/** Wires the service worker's forwarded Background Sync opportunity
 * (src/app/sw.ts) to a foreground sync pass. Call once per page/profile. */
export function listenForBackgroundSyncMessages(profileId: string): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "breedops-background-sync") {
      void syncPendingOperations(profileId);
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
