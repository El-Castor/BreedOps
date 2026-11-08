// Shared types for the V2-07 offline/PWA field workflow. Deliberately kept
// framework-agnostic (no "server-only"/"use client" markers, no I/O) so the
// same shapes are usable from: the authenticated server action that builds
// an offline pack (src/app/app/field-packs/actions.ts), the client
// IndexedDB layer (src/lib/offline/db.ts), the field entry UI, and the
// /api/offline-sync route and its idempotency wrapper.

/** One active trait definition as captured into an offline pack, mirroring
 * the fields `program_active_traits()` returns (supabase/migrations/
 * 000016_configurable_phenotyping.sql) - everything `submit_trait_evaluation()`
 * needs to validate a value client-side for immediate UX. Server validation
 * at sync time remains authoritative (V2-07 spec §14). */
export interface OfflineTraitDefinition {
  traitId: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  dataType:
    | "numeric"
    | "integer"
    | "ordinal"
    | "boolean"
    | "date"
    | "categorical"
    | "text";
  unit: string | null;
  minimumValue: number | null;
  maximumValue: number | null;
  decimalPlaces: number | null;
  allowedValues: string[] | null;
  direction: string | null;
  targetValue: number | null;
  protocol: string | null;
  moduleId: string;
  moduleName: string;
  moduleOrder: number;
  traitOrder: number;
}

/** One candidate/phenotype the field workflow can enter evaluations for. */
export interface OfflinePhenotypeEntry {
  phenotypeId: string;
  phenotypeCode: string;
  label: string;
  /** Entity type/id pair for existing QR identifiers this pack can resolve
   * locally without a network round-trip (V2-07 §29). Null when the
   * phenotype has no QR mapping. */
  qr: { entityType: string; entityId: string } | null;
}

/** The full offline pack: everything the field workspace needs for one
 * trial, scoped to one user/program/trial (V2-07 §7). Only what the
 * supported offline workflow actually needs - never a full analytics
 * history, never other programs. */
export interface OfflinePack {
  /** `${profileId}:${trialId}` - user-scoped so two profiles on the same
   * browser profile (e.g. a shared field tablet between logouts) never
   * collide, and so logout can delete-by-profile cleanly. */
  packId: string;
  schemaVersion: number;
  profileId: string;
  organizationId: string;
  programId: string;
  programCode: string;
  programName: string;
  trialId: string;
  trialCode: string;
  trialName: string;
  entries: OfflinePhenotypeEntry[];
  activeTraits: OfflineTraitDefinition[];
  /** Authoritative PostgreSQL fingerprint captured with the pack snapshot.
   * It covers every configuration element that can affect validation or
   * scoring (active traits, model, criteria, weights, eliminatory gates and
   * decision rules) and is checked transactionally at sync time. */
  configFingerprint: string;
  snapshotCreatedAt: string;
}

export type OfflineOperationType = "PHENOTYPE_TRAIT_EVALUATION";

export type OfflineOperationStatus =
  | "DRAFT"
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "CONFLICT"
  | "FAILED";

/** Structured, machine-readable outcome codes a sync attempt can return for
 * one operation (V2-07 §16). Never collapsed into a generic "sync failed". */
export type OfflineSyncResultCode =
  | "SYNCED"
  | "AUTH_REQUIRED"
  | "PERMISSION_REVOKED"
  | "TARGET_NOT_FOUND"
  | "TARGET_ARCHIVED"
  | "CONFIG_CHANGED"
  | "VALIDATION_REJECTED"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "RETRYABLE_SERVER_ERROR";

export interface PhenotypeTraitEvaluationPayload {
  phenotypeId: string;
  evaluationDate: string;
  /** Keyed by trait code, same shape `submitTraitEvaluation()` already
   * builds server-side (src/app/app/phenotypes/actions.ts) - values are
   * already converted per data_type on the client for immediate UX, and
   * re-validated unconditionally server-side at sync time. */
  values: Record<string, string | number | boolean>;
  notes: string | null;
}

/** One queued local mutation. Immutable once created except for its status/
 * attempt bookkeeping fields (V2-07 §12) - operationId is the client-
 * generated idempotency key carried through to the server. */
export interface OfflineOutboxOperation {
  operationId: string;
  operationType: OfflineOperationType;
  packId: string;
  profileId: string;
  organizationId: string;
  programId: string;
  trialId: string;
  /** The fingerprint of the pack this operation was entered against -
   * compared to the server's current fingerprint at sync time. */
  packConfigurationFingerprint: string;
  payload: PhenotypeTraitEvaluationPayload;
  /** Stable hash of `payload`, used by the server to tell a genuine retry
   * of the same operation from a reused operationId with different
   * content (V2-07 §13, §34). */
  payloadHash: string;
  status: OfflineOperationStatus;
  createdAtClient: string;
  updatedAtClient: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastResultCode: OfflineSyncResultCode | null;
  lastError: string | null;
  /** Set once the server has acknowledged this operation - the evaluation
   * id created (or reused, on retry) by submit_trait_evaluation(). Only
   * ever set when status is SYNCED. */
  syncedEvaluationId: string | null;
  /** Display label resolved at creation time so the outbox UI never shows a
   * bare UUID as its primary label (V2-07 §22). */
  candidateLabel: string;
}

/** Per-pack synchronization bookkeeping (V2-07 §21, §23). */
export interface OfflineSyncState {
  packId: string;
  lastSyncAttemptAt: string | null;
  lastSyncSuccessAt: string | null;
  isSyncing: boolean;
}
