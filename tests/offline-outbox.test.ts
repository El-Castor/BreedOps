import { describe, expect, it } from "vitest";
import {
  buildPhenotypeEvaluationOperation,
  markConflict,
  markFailed,
  markPendingRetry,
  markSynced,
  markSyncing,
} from "../src/lib/offline/outbox";
import { computePayloadHash } from "../src/lib/offline/payload-hash";
import type { OfflinePack } from "../src/lib/offline/types";

const pack: OfflinePack = {
  packId: "profile-1:trial-1",
  schemaVersion: 1,
  profileId: "profile-1",
  organizationId: "org-1",
  programId: "program-1",
  programCode: "PRG",
  programName: "Programme test",
  trialId: "trial-1",
  trialCode: "T1",
  trialName: "Essai test",
  entries: [],
  activeTraits: [],
  configFingerprint: "fingerprint-1",
  snapshotCreatedAt: "2026-11-06T10:00:00.000Z",
};

describe("buildPhenotypeEvaluationOperation", () => {
  it("builds a PENDING operation with a fresh operation_id and matching payload hash", async () => {
    const op = await buildPhenotypeEvaluationOperation({
      pack,
      phenotypeId: "pheno-1",
      candidateLabel: "P-001",
      evaluationDate: "2026-11-06",
      values: { height: 120 },
      notes: "RAS",
    });

    expect(op.status).toBe("PENDING");
    expect(op.attemptCount).toBe(0);
    expect(op.packId).toBe(pack.packId);
    expect(op.profileId).toBe(pack.profileId);
    expect(op.packConfigurationFingerprint).toBe(pack.configFingerprint);
    expect(op.payloadHash).toBe(await computePayloadHash(op.payload));
    expect(op.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates a distinct operation_id on every call, even for identical input", async () => {
    const params = {
      pack,
      phenotypeId: "pheno-1",
      candidateLabel: "P-001",
      evaluationDate: "2026-11-06",
      values: { height: 120 },
      notes: null,
    };
    const a = await buildPhenotypeEvaluationOperation(params);
    const b = await buildPhenotypeEvaluationOperation(params);
    expect(a.operationId).not.toBe(b.operationId);
    // Same content, so the payload hash the server checks idempotency
    // against is identical even though the client-side ids differ.
    expect(a.payloadHash).toBe(b.payloadHash);
  });
});

describe("outbox status transitions", () => {
  const base = {
    operationId: "op-1",
    operationType: "PHENOTYPE_TRAIT_EVALUATION" as const,
    packId: pack.packId,
    profileId: pack.profileId,
    organizationId: pack.organizationId,
    programId: pack.programId,
    trialId: pack.trialId,
    packConfigurationFingerprint: pack.configFingerprint,
    payload: {
      phenotypeId: "pheno-1",
      evaluationDate: "2026-11-06",
      values: { height: 120 },
      notes: null,
    },
    payloadHash: "hash-1",
    status: "PENDING" as const,
    createdAtClient: "2026-11-06T10:00:00.000Z",
    updatedAtClient: "2026-11-06T10:00:00.000Z",
    attemptCount: 0,
    lastAttemptAt: null,
    lastResultCode: null,
    lastError: null,
    syncedEvaluationId: null,
    candidateLabel: "P-001",
  };

  it("markSyncing increments attemptCount and sets status", () => {
    const next = markSyncing(base);
    expect(next.status).toBe("SYNCING");
    expect(next.attemptCount).toBe(1);
    expect(next.lastAttemptAt).not.toBeNull();
  });

  it("markSynced records the server-assigned evaluation id and clears error state", () => {
    const next = markSynced(markSyncing(base), "evaluation-123");
    expect(next.status).toBe("SYNCED");
    expect(next.syncedEvaluationId).toBe("evaluation-123");
    expect(next.lastResultCode).toBe("SYNCED");
    expect(next.lastError).toBeNull();
  });

  it("markConflict never clears the payload - the local observation is retained", () => {
    const next = markConflict(
      markSyncing(base),
      "CONFIG_CHANGED",
      "La configuration a changé.",
    );
    expect(next.status).toBe("CONFLICT");
    expect(next.lastResultCode).toBe("CONFIG_CHANGED");
    expect(next.payload).toEqual(base.payload);
  });

  it("markFailed keeps the operation retryable (not a terminal conflict)", () => {
    const next = markFailed(markSyncing(base), "Network error");
    expect(next.status).toBe("FAILED");
    expect(next.lastResultCode).toBe("RETRYABLE_SERVER_ERROR");
  });

  it("markPendingRetry returns a FAILED operation to PENDING for the sync engine to pick up again", () => {
    const failed = markFailed(markSyncing(base), "Network error");
    const retried = markPendingRetry(failed);
    expect(retried.status).toBe("PENDING");
  });
});
