import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as offlineDb from "../src/lib/offline/db";
import { summarizeOutbox } from "../src/lib/offline/outbox-summary";
import type { OfflineOutboxOperation } from "../src/lib/offline/types";

const DB_NAME = "breedops-offline";

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function op(
  overrides: Partial<OfflineOutboxOperation>,
): OfflineOutboxOperation {
  return {
    operationId: "op-1",
    operationType: "PHENOTYPE_TRAIT_EVALUATION",
    packId: "profile-1:trial-1",
    profileId: "profile-1",
    organizationId: "org-1",
    programId: "program-1",
    trialId: "trial-1",
    packConfigurationFingerprint: "fingerprint-1",
    payload: {
      phenotypeId: "pheno-1",
      evaluationDate: "2026-11-06",
      values: { height: 120 },
      notes: null,
    },
    payloadHash: "hash-1",
    status: "PENDING",
    createdAtClient: "2026-11-06T10:00:00.000Z",
    updatedAtClient: "2026-11-06T10:00:00.000Z",
    attemptCount: 0,
    lastAttemptAt: null,
    lastResultCode: null,
    lastError: null,
    syncedEvaluationId: null,
    candidateLabel: "P-001",
    ...overrides,
  };
}

describe("summarizeOutbox", () => {
  beforeEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
  });
  afterEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
  });

  it("counts operations by status, keyed to one profile", async () => {
    await offlineDb.putOperation(op({ operationId: "a", status: "PENDING" }));
    await offlineDb.putOperation(op({ operationId: "b", status: "SYNCING" }));
    await offlineDb.putOperation(op({ operationId: "c", status: "CONFLICT" }));
    await offlineDb.putOperation(op({ operationId: "d", status: "FAILED" }));
    await offlineDb.putOperation(op({ operationId: "e", status: "SYNCED" }));
    await offlineDb.putOperation(
      op({ operationId: "f", status: "PENDING", profileId: "profile-2" }),
    );

    const summary = await summarizeOutbox("profile-1");
    expect(summary).toEqual({
      pending: 1,
      syncing: 1,
      conflicts: 1,
      failed: 1,
      synced: 1,
      total: 5,
    });
  });
});
