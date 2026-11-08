import "fake-indexeddb/auto";
import { type DBSchema, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as offlineDb from "../src/lib/offline/db";
import { computePayloadHash } from "../src/lib/offline/payload-hash";
import type {
  OfflineOutboxOperation,
  OfflinePack,
  OfflineTraitDefinition,
} from "../src/lib/offline/types";

const DB_NAME = "breedops-offline";

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

// The module-level connection singleton (src/lib/offline/db.ts) must be
// closed before the database can be deleted between tests - IndexedDB
// blocks a delete while any connection to that database stays open.
async function freshDbModule() {
  await offlineDb.closeOfflineDb();
  await deleteDb(DB_NAME);
  return offlineDb;
}

function samplePack(overrides: Partial<OfflinePack> = {}): OfflinePack {
  return {
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
    snapshotCreatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function sampleOperation(
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
    createdAtClient: new Date().toISOString(),
    updatedAtClient: new Date().toISOString(),
    attemptCount: 0,
    lastAttemptAt: null,
    lastResultCode: null,
    lastError: null,
    syncedEvaluationId: null,
    candidateLabel: "P-001",
    ...overrides,
  };
}

describe("offline IndexedDB layer", () => {
  beforeEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
  });
  afterEach(async () => {
    await offlineDb.closeOfflineDb();
    await deleteDb(DB_NAME);
  });

  it("stores and retrieves a pack", async () => {
    const db = await freshDbModule();
    await db.putPack(samplePack());
    const loaded = await db.getPack("profile-1:trial-1");
    expect(loaded?.trialCode).toBe("T1");
  });

  it("lists packs scoped to one profile only", async () => {
    const db = await freshDbModule();
    await db.putPack(
      samplePack({ packId: "profile-1:trial-1", profileId: "profile-1" }),
    );
    await db.putPack(
      samplePack({ packId: "profile-2:trial-1", profileId: "profile-2" }),
    );
    const packs = await db.listPacksForProfile("profile-1");
    expect(packs).toHaveLength(1);
    expect(packs[0].profileId).toBe("profile-1");
  });

  it("deleting a pack record never removes its outbox operations", async () => {
    const db = await freshDbModule();
    await db.putPack(samplePack());
    await db.putOperation(sampleOperation());
    await db.deletePackRecord("profile-1:trial-1");
    expect(await db.getPack("profile-1:trial-1")).toBeUndefined();
    expect(await db.getOperation("op-1")).toBeDefined();
  });

  it("lists operations by pack and by status", async () => {
    const db = await freshDbModule();
    await db.putOperation(
      sampleOperation({ operationId: "op-1", status: "PENDING" }),
    );
    await db.putOperation(
      sampleOperation({ operationId: "op-2", status: "SYNCED" }),
    );
    await db.putOperation(
      sampleOperation({
        operationId: "op-3",
        packId: "profile-1:trial-2",
        trialId: "trial-2",
        status: "PENDING",
      }),
    );
    expect(await db.listOperationsForPack("profile-1:trial-1")).toHaveLength(2);
    expect(await db.listOperationsByStatus("PENDING")).toHaveLength(2);
    expect(await db.listOperationsByStatus("SYNCED")).toHaveLength(1);
  });

  it("counts unsynced operations for a profile, excluding SYNCED", async () => {
    const db = await freshDbModule();
    await db.putOperation(
      sampleOperation({ operationId: "op-1", status: "PENDING" }),
    );
    await db.putOperation(
      sampleOperation({ operationId: "op-2", status: "SYNCED" }),
    );
    await db.putOperation(
      sampleOperation({ operationId: "op-3", status: "CONFLICT" }),
    );
    expect(await db.countUnsyncedOperationsForProfile("profile-1")).toBe(2);
  });

  it("only deletes an operation on an explicit discard call", async () => {
    const db = await freshDbModule();
    await db.putOperation(sampleOperation());
    await db.deleteOperation("op-1");
    expect(await db.getOperation("op-1")).toBeUndefined();
  });

  it("tracks per-pack sync state", async () => {
    const db = await freshDbModule();
    await db.putSyncState({
      packId: "profile-1:trial-1",
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      isSyncing: false,
    });
    await db.putSyncState({
      packId: "profile-1:trial-1",
      lastSyncAttemptAt: "2026-11-06T10:00:00.000Z",
      lastSyncSuccessAt: "2026-11-06T10:00:01.000Z",
      isSyncing: false,
    });
    const state = await db.getSyncState("profile-1:trial-1");
    expect(state?.lastSyncSuccessAt).toBe("2026-11-06T10:00:01.000Z");
  });

  it("clearing one profile's data never touches another profile's packs or outbox", async () => {
    const db = await freshDbModule();
    await db.putPack(
      samplePack({ packId: "profile-1:trial-1", profileId: "profile-1" }),
    );
    await db.putPack(
      samplePack({ packId: "profile-2:trial-1", profileId: "profile-2" }),
    );
    await db.putOperation(
      sampleOperation({ operationId: "op-1", profileId: "profile-1" }),
    );
    await db.putOperation(
      sampleOperation({ operationId: "op-2", profileId: "profile-2" }),
    );

    await db.clearProfileOfflineData("profile-1");

    expect(await db.getPack("profile-1:trial-1")).toBeUndefined();
    expect(await db.getOperation("op-1")).toBeUndefined();
    expect(await db.getPack("profile-2:trial-1")).toBeDefined();
    expect(await db.getOperation("op-2")).toBeDefined();
  });
});

describe("IndexedDB schema upgrades are forward-safe", () => {
  const UPGRADE_DB_NAME = "breedops-offline-upgrade-test";

  afterEach(async () => {
    await deleteDb(UPGRADE_DB_NAME);
  });

  it("preserves existing records and adds a new store/index across a version bump", async () => {
    interface V1Schema extends DBSchema {
      packs: { key: string; value: { packId: string; label: string } };
    }
    const v1 = await openDB<V1Schema>(UPGRADE_DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("packs", { keyPath: "packId" });
      },
    });
    await v1.put("packs", { packId: "p1", label: "before upgrade" });
    v1.close();

    interface V2Schema extends DBSchema {
      packs: { key: string; value: { packId: string; label: string } };
      outbox: {
        key: string;
        value: { operationId: string };
        indexes: { byPack: string };
      };
    }
    const v2 = await openDB<V2Schema>(UPGRADE_DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 2) {
          const outbox = db.createObjectStore("outbox", {
            keyPath: "operationId",
          });
          outbox.createIndex("byPack", "packId");
        }
      },
    });

    const preserved = await v2.get("packs", "p1");
    expect(preserved?.label).toBe("before upgrade");
    expect(v2.objectStoreNames.contains("outbox")).toBe(true);
    v2.close();
  });
});

describe("computePayloadHash", () => {
  it("is independent of object key order", async () => {
    const a = await computePayloadHash({
      phenotypeId: "p1",
      values: { height: 10, width: 5 },
    });
    const b = await computePayloadHash({
      values: { width: 5, height: 10 },
      phenotypeId: "p1",
    });
    expect(a).toBe(b);
  });

  it("changes when the payload content changes", async () => {
    const a = await computePayloadHash({
      phenotypeId: "p1",
      values: { height: 10 },
    });
    const b = await computePayloadHash({
      phenotypeId: "p1",
      values: { height: 11 },
    });
    expect(a).not.toBe(b);
  });
});
