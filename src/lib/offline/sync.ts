import {
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

const scheduledRetries = new Set<string>();

function scheduleRetry(op: OfflineOutboxOperation, profileId: string) {
  if (scheduledRetries.has(op.operationId)) return;
  scheduledRetries.add(op.operationId);
  setTimeout(() => {
    scheduledRetries.delete(op.operationId);
    putOperation(markPendingRetry(op)).then(() => {
      if (navigator.onLine) void syncPendingOperations(profileId);
    });
  }, backoffDelayMs(op.attemptCount));
}

/** Sends every PENDING operation for a profile to /api/offline-sync,
 * batched to the server's own bound, and applies the resulting status
 * transitions. Safe to call concurrently/repeatedly - an operation already
 * SYNCING, SYNCED or CONFLICT is never re-sent by this pass. */
export async function syncPendingOperations(
  profileId: string,
): Promise<SyncSummary> {
  const all = await listOperationsForProfile(profileId);
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
    const stillPending = (await listOperationsForProfile(profileId)).some(
      (op) => op.packId === packId && op.status === "PENDING",
    );
    await putSyncState({
      packId,
      lastSyncAttemptAt: state?.lastSyncAttemptAt ?? new Date().toISOString(),
      lastSyncSuccessAt: stillPending
        ? state?.lastSyncSuccessAt ?? null
        : new Date().toISOString(),
      isSyncing: false,
    });
  }

  return summary;
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
