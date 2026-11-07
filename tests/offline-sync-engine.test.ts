import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as offlineDb from "../src/lib/offline/db";
import { syncPendingOperations } from "../src/lib/offline/sync";
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

function pendingOperation(
  overrides: Partial<OfflineOutboxOperation> = {},
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

describe("syncPendingOperations", () => {
  beforeEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
    vi.restoreAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
    vi.unstubAllGlobals();
  });

  it("marks a SYNCED result and records the server-assigned evaluation id", async () => {
    await offlineDb.putOperation(pendingOperation());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                operationId: "op-1",
                resultCode: "SYNCED",
                evaluationId: "eval-1",
                replay: false,
                message: "Synchronisé.",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const summary = await syncPendingOperations("profile-1");
    expect(summary.synced).toBe(1);
    expect(summary.conflicts).toBe(0);
    expect(summary.failed).toBe(0);

    const op = await offlineDb.getOperation("op-1");
    expect(op?.status).toBe("SYNCED");
    expect(op?.syncedEvaluationId).toBe("eval-1");
  });

  it("marks a business result (e.g. CONFIG_CHANGED) as CONFLICT and never discards the payload", async () => {
    await offlineDb.putOperation(pendingOperation());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                operationId: "op-1",
                resultCode: "CONFIG_CHANGED",
                message: "La configuration a changé.",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const summary = await syncPendingOperations("profile-1");
    expect(summary.conflicts).toBe(1);

    const op = await offlineDb.getOperation("op-1");
    expect(op?.status).toBe("CONFLICT");
    expect(op?.lastResultCode).toBe("CONFIG_CHANGED");
    expect(op?.payload.values).toEqual({ height: 120 });
  });

  it("marks RETRYABLE_SERVER_ERROR as FAILED, never as a silent conflict", async () => {
    await offlineDb.putOperation(pendingOperation());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                operationId: "op-1",
                resultCode: "RETRYABLE_SERVER_ERROR",
                message: "Erreur temporaire.",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const summary = await syncPendingOperations("profile-1");
    expect(summary.failed).toBe(1);
    const op = await offlineDb.getOperation("op-1");
    expect(op?.status).toBe("FAILED");
  });

  it("treats a network failure as retryable (FAILED), not a conflict", async () => {
    await offlineDb.putOperation(pendingOperation());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network error")),
    );

    const summary = await syncPendingOperations("profile-1");
    expect(summary.failed).toBe(1);
    const op = await offlineDb.getOperation("op-1");
    expect(op?.status).toBe("FAILED");
  });

  it("reports authRequired on HTTP 401 and leaves the operation PENDING (never discards the queue)", async () => {
    await offlineDb.putOperation(pendingOperation());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
          status: 401,
        }),
      ),
    );

    const summary = await syncPendingOperations("profile-1");
    expect(summary.authRequired).toBe(true);
    const op = await offlineDb.getOperation("op-1");
    expect(op?.status).toBe("PENDING");
  });

  it("never re-sends an operation that is already SYNCED or CONFLICT", async () => {
    await offlineDb.putOperation(
      pendingOperation({ operationId: "synced-op", status: "SYNCED" }),
    );
    await offlineDb.putOperation(
      pendingOperation({ operationId: "conflict-op", status: "CONFLICT" }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncPendingOperations("profile-1");
    expect(summary.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches more than 25 pending operations into multiple requests", async () => {
    for (let i = 0; i < 26; i++) {
      await offlineDb.putOperation(
        pendingOperation({ operationId: `op-${i}`, payloadHash: `hash-${i}` }),
      );
    }
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        operations: { operationId: string }[];
      };
      return new Response(
        JSON.stringify({
          results: body.operations.map((op) => ({
            operationId: op.operationId,
            resultCode: "SYNCED",
            evaluationId: `eval-${op.operationId}`,
            message: "Synchronisé.",
          })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncPendingOperations("profile-1");
    expect(summary.synced).toBe(26);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
