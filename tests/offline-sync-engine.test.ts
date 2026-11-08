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
    vi.useRealTimers();
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
    vi.restoreAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(async () => {
    vi.useRealTimers();
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

  it("recovers a persisted SYNCING operation after an interrupted previous page and safely resends it", async () => {
    await offlineDb.putOperation(
      pendingOperation({
        operationId: "crash-syncing-op",
        status: "SYNCING",
        attemptCount: 1,
        lastAttemptAt: "2026-11-06T10:00:00.000Z",
      }),
    );
    await offlineDb.putSyncState({
      packId: "profile-1:trial-1",
      lastSyncAttemptAt: "2026-11-06T10:00:00.000Z",
      lastSyncSuccessAt: null,
      isSyncing: true,
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              operationId: "crash-syncing-op",
              resultCode: "SYNCED",
              evaluationId: "eval-crash-replay",
              replay: true,
              message: "Synchronisé.",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncPendingOperations("profile-1");

    expect(summary.attempted).toBe(1);
    expect(summary.synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const op = await offlineDb.getOperation("crash-syncing-op");
    expect(op?.status).toBe("SYNCED");
    expect(op?.attemptCount).toBe(2);
    expect(op?.syncedEvaluationId).toBe("eval-crash-replay");

    const state = await offlineDb.getSyncState("profile-1:trial-1");
    expect(state?.isSyncing).toBe(false);
    expect(state?.lastSyncSuccessAt).not.toBeNull();
  });

  it("recovers an expired persisted FAILED retry after a page restart", async () => {
    await offlineDb.putOperation(
      pendingOperation({
        operationId: "restart-failed-op",
        status: "FAILED",
        attemptCount: 1,
        lastAttemptAt: "2000-01-01T00:00:00.000Z",
        lastResultCode: "RETRYABLE_SERVER_ERROR",
        lastError: "Ancienne erreur réseau.",
      }),
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              operationId: "restart-failed-op",
              resultCode: "SYNCED",
              evaluationId: "eval-recovered-failed",
              replay: false,
              message: "Synchronisé.",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await syncPendingOperations("profile-1");

    expect(summary.attempted).toBe(1);
    expect(summary.synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const op = await offlineDb.getOperation("restart-failed-op");
    expect(op?.status).toBe("SYNCED");
    expect(op?.attemptCount).toBe(2);
  });

  it("preserves the remaining persisted FAILED backoff instead of retrying immediately after restart", async () => {
    // attemptCount=1 => 4 s backoff. Pretend 3.92 s already elapsed so
    // only ~80 ms remain. Real timers are intentional: fake-indexeddb also
    // relies on asynchronous timer/task scheduling.
    const lastAttemptAt = new Date(Date.now() - 3920).toISOString();

    await offlineDb.putOperation(
      pendingOperation({
        operationId: "backoff-restart-op",
        status: "FAILED",
        attemptCount: 1,
        lastAttemptAt,
        lastResultCode: "RETRYABLE_SERVER_ERROR",
        lastError: "Erreur temporaire.",
      }),
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              operationId: "backoff-restart-op",
              resultCode: "SYNCED",
              evaluationId: "eval-after-backoff",
              replay: false,
              message: "Synchronisé.",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const initial = await syncPendingOperations("profile-1");

    expect(initial.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await offlineDb.getOperation("backoff-restart-op"))?.status).toBe(
      "FAILED",
    );

    // The persisted backoff must not be ignored and retried immediately.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();

    // After the remaining delay expires, the durable FAILED row is
    // requeued and synchronized automatically.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await offlineDb.getOperation("backoff-restart-op"))?.status).toBe(
      "SYNCED",
    );
  });

  it("never lets an obsolete retry timer overwrite an operation that became SYNCED meanwhile", async () => {
    const lastAttemptAt = new Date(Date.now() - 3920).toISOString();

    await offlineDb.putOperation(
      pendingOperation({
        operationId: "stale-timer-op",
        status: "FAILED",
        attemptCount: 1,
        lastAttemptAt,
        lastResultCode: "RETRYABLE_SERVER_ERROR",
        lastError: "Erreur réseau précédente.",
      }),
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Recovery sees FAILED with a small amount of backoff remaining and
    // schedules a retry without sending immediately.
    const initial = await syncPendingOperations("profile-1");
    expect(initial.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    const failed = await offlineDb.getOperation("stale-timer-op");
    expect(failed?.status).toBe("FAILED");

    // Simulate another path learning that the server had already committed
    // and persisting the final acknowledgement before the old timer fires.
    await offlineDb.putOperation({
      ...failed!,
      status: "SYNCED",
      syncedEvaluationId: "eval-ack-recovered",
      lastResultCode: "SYNCED",
      lastError: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const final = await offlineDb.getOperation("stale-timer-op");
    expect(final?.status).toBe("SYNCED");
    expect(final?.syncedEvaluationId).toBe("eval-ack-recovered");

    // The stale timer re-reads IndexedDB and therefore refuses to requeue
    // the now-SYNCED operation.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coalesces concurrent sync triggers and never POSTs the same pending operation twice", async () => {
    await offlineDb.putOperation(
      pendingOperation({ operationId: "concurrent-op" }),
    );

    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const fetchMock = vi.fn().mockImplementation(async () => {
      await responseGate;
      return new Response(
        JSON.stringify({
          results: [
            {
              operationId: "concurrent-op",
              resultCode: "SYNCED",
              evaluationId: "eval-concurrent",
              replay: false,
              message: "Synchronisé.",
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = syncPendingOperations("profile-1");
    const second = syncPendingOperations("profile-1");

    expect(second).toBe(first);

    releaseResponse();

    const [a, b] = await Promise.all([first, second]);

    expect(a.synced).toBe(1);
    expect(b.synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await offlineDb.getOperation("concurrent-op"))?.status).toBe(
      "SYNCED",
    );
  });

  it("does not advance lastSyncSuccessAt when a sync attempt ends in FAILED", async () => {
    const previousSuccess = "2026-11-06T08:00:00.000Z";

    await offlineDb.putOperation(
      pendingOperation({ operationId: "failed-success-clock-op" }),
    );
    await offlineDb.putSyncState({
      packId: "profile-1:trial-1",
      lastSyncAttemptAt: "2026-11-06T07:59:00.000Z",
      lastSyncSuccessAt: previousSuccess,
      isSyncing: false,
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("temporary failure", { status: 503 })),
    );

    const summary = await syncPendingOperations("profile-1");

    expect(summary.failed).toBe(1);

    const state = await offlineDb.getSyncState("profile-1:trial-1");
    expect(state?.lastSyncSuccessAt).toBe(previousSuccess);
    expect(state?.isSyncing).toBe(false);

    // Prevent the retry timer created by this test from ever being able to
    // requeue the row if the test process remains alive long enough.
    const failed = await offlineDb.getOperation("failed-success-clock-op");
    await offlineDb.putOperation({
      ...failed!,
      status: "SYNCED",
      syncedEvaluationId: "test-cleanup",
      lastResultCode: "SYNCED",
      lastError: null,
    });
  });

  it("advances lastSyncSuccessAt only when every operation in the touched pack is SYNCED", async () => {
    const previousSuccess = "2026-11-06T08:00:00.000Z";

    await offlineDb.putOperation(
      pendingOperation({ operationId: "success-clock-op" }),
    );
    await offlineDb.putSyncState({
      packId: "profile-1:trial-1",
      lastSyncAttemptAt: "2026-11-06T07:59:00.000Z",
      lastSyncSuccessAt: previousSuccess,
      isSyncing: false,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                operationId: "success-clock-op",
                resultCode: "SYNCED",
                evaluationId: "eval-success-clock",
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

    const state = await offlineDb.getSyncState("profile-1:trial-1");
    expect(state?.lastSyncSuccessAt).not.toBeNull();
    expect(state?.lastSyncSuccessAt).not.toBe(previousSuccess);
    expect(state?.isSyncing).toBe(false);
  });
});
