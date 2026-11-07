import { computePayloadHash } from "./payload-hash";
import type {
  OfflineOutboxOperation,
  OfflinePack,
  OfflineSyncResultCode,
  PhenotypeTraitEvaluationPayload,
} from "./types";

/** Builds a new, immutable-once-created outbox operation from a field
 * entry form submission (V2-07 §12). Pure aside from the payload hash
 * (Web Crypto, async) and the operation_id itself (crypto.randomUUID()) -
 * no IndexedDB access here, so this is unit-testable without
 * fake-indexeddb; the caller persists the result with putOperation()
 * (src/lib/offline/db.ts). Status starts at PENDING: BreedOps has a
 * single "Enregistrer" action in the field workspace that both saves the
 * evaluation locally and queues it for sync in one step (V2-07 §6), there
 * is no separate explicit draft-then-queue step in V1 - DRAFT remains a
 * defined status (V2-07 §12) for a future autosave-before-save use, but
 * nothing in this milestone produces it. */
export async function buildPhenotypeEvaluationOperation(params: {
  pack: OfflinePack;
  phenotypeId: string;
  candidateLabel: string;
  evaluationDate: string;
  values: PhenotypeTraitEvaluationPayload["values"];
  notes: string | null;
}): Promise<OfflineOutboxOperation> {
  const payload: PhenotypeTraitEvaluationPayload = {
    phenotypeId: params.phenotypeId,
    evaluationDate: params.evaluationDate,
    values: params.values,
    notes: params.notes,
  };
  const now = new Date().toISOString();
  return {
    operationId: crypto.randomUUID(),
    operationType: "PHENOTYPE_TRAIT_EVALUATION",
    packId: params.pack.packId,
    profileId: params.pack.profileId,
    organizationId: params.pack.organizationId,
    programId: params.pack.programId,
    trialId: params.pack.trialId,
    packConfigurationFingerprint: params.pack.configFingerprint,
    payload,
    payloadHash: await computePayloadHash(payload),
    status: "PENDING",
    createdAtClient: now,
    updatedAtClient: now,
    attemptCount: 0,
    lastAttemptAt: null,
    lastResultCode: null,
    lastError: null,
    syncedEvaluationId: null,
    candidateLabel: params.candidateLabel,
  };
}

/** Pure status-transition helpers (V2-07 §12 state machine: DRAFT -> PENDING
 * -> SYNCING -> SYNCED/CONFLICT/FAILED). Each returns a new object; the
 * caller persists it with putOperation(). Keeping these pure makes the
 * sync engine's decisions (src/lib/offline/sync.ts, next) unit-testable
 * without a real IndexedDB round-trip for every transition. */

export function markSyncing(
  op: OfflineOutboxOperation,
): OfflineOutboxOperation {
  const now = new Date().toISOString();
  return {
    ...op,
    status: "SYNCING",
    attemptCount: op.attemptCount + 1,
    lastAttemptAt: now,
    updatedAtClient: now,
  };
}

export function markSynced(
  op: OfflineOutboxOperation,
  evaluationId: string,
): OfflineOutboxOperation {
  const now = new Date().toISOString();
  return {
    ...op,
    status: "SYNCED",
    syncedEvaluationId: evaluationId,
    lastResultCode: "SYNCED",
    lastError: null,
    updatedAtClient: now,
  };
}

/** A conflict is never auto-resolved and never discards the local payload
 * (V2-07 §17) - the operation stays in IndexedDB exactly as entered, only
 * its status/diagnostic fields change, so the user can inspect, retry
 * after reconnecting, re-enter under current configuration, or explicitly
 * discard it. */
export function markConflict(
  op: OfflineOutboxOperation,
  resultCode: OfflineSyncResultCode,
  message: string,
): OfflineOutboxOperation {
  const now = new Date().toISOString();
  return {
    ...op,
    status: "CONFLICT",
    lastResultCode: resultCode,
    lastError: message,
    updatedAtClient: now,
  };
}

/** A retryable failure (network error, RETRYABLE_SERVER_ERROR) - the sync
 * engine may attempt this operation again later with bounded backoff;
 * unlike markConflict this is never shown as needing user intervention
 * until retries are exhausted at the UI layer's discretion. */
export function markFailed(
  op: OfflineOutboxOperation,
  message: string,
): OfflineOutboxOperation {
  const now = new Date().toISOString();
  return {
    ...op,
    status: "FAILED",
    lastResultCode: "RETRYABLE_SERVER_ERROR",
    lastError: message,
    updatedAtClient: now,
  };
}

/** Returns an operation to PENDING for a fresh attempt - used both for a
 * manual retry and for requeuing a FAILED operation the sync engine will
 * pick up again. */
export function markPendingRetry(
  op: OfflineOutboxOperation,
): OfflineOutboxOperation {
  return {
    ...op,
    status: "PENDING",
    updatedAtClient: new Date().toISOString(),
  };
}
