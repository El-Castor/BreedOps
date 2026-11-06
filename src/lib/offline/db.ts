import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type {
  OfflineOperationStatus,
  OfflineOutboxOperation,
  OfflinePack,
  OfflineSyncState,
} from "./types";

// Client-only (browser IndexedDB). Never imported for its side effects at
// module scope - every exported function only touches `indexedDB` when
// actually called, so importing this module from the wrong place fails
// loudly at call time rather than silently at import time.

const DB_NAME = "breedops-offline";
/** Bump alongside an `upgrade()` branch below whenever a stored shape
 * changes - V2-07 §8/§27 require schema upgrades to be forward-safe and
 * tested (tests/offline-db.test.ts exercises a v1 -> v2 upgrade path with
 * fake-indexeddb). */
const DB_VERSION = 1;

interface BreedOpsOfflineDB extends DBSchema {
  packs: {
    key: string;
    value: OfflinePack;
    indexes: { byProfile: string };
  };
  outbox: {
    key: string;
    value: OfflineOutboxOperation;
    indexes: {
      byPack: string;
      byStatus: OfflineOperationStatus;
      byProfile: string;
    };
  };
  syncState: {
    key: string;
    value: OfflineSyncState;
  };
}

let dbPromise: Promise<IDBPDatabase<BreedOpsOfflineDB>> | null = null;

/** Test-only: closes the cached connection and clears the module-level
 * singleton so the next `openOfflineDb()` call reconnects from scratch.
 * IndexedDB blocks a same-name delete/upgrade while a connection is still
 * open, so tests that delete the database between cases must close it
 * first via this - production code has no equivalent need since the
 * database is never deleted out from under a live page. */
export async function closeOfflineDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

export function openOfflineDb(): Promise<IDBPDatabase<BreedOpsOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BreedOpsOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const packs = db.createObjectStore("packs", { keyPath: "packId" });
          packs.createIndex("byProfile", "profileId");

          const outbox = db.createObjectStore("outbox", {
            keyPath: "operationId",
          });
          outbox.createIndex("byPack", "packId");
          outbox.createIndex("byStatus", "status");
          outbox.createIndex("byProfile", "profileId");

          db.createObjectStore("syncState", { keyPath: "packId" });
        }
      },
    });
  }
  return dbPromise;
}

// ───────────────────────── Packs ─────────────────────────

export async function putPack(pack: OfflinePack): Promise<void> {
  const db = await openOfflineDb();
  await db.put("packs", pack);
}

export async function getPack(
  packId: string,
): Promise<OfflinePack | undefined> {
  const db = await openOfflineDb();
  return db.get("packs", packId);
}

export async function listPacksForProfile(
  profileId: string,
): Promise<OfflinePack[]> {
  const db = await openOfflineDb();
  return db.getAllFromIndex("packs", "byProfile", profileId);
}

/** Every pack regardless of profile - only for the field workspace's
 * fallback profile discovery (src/app/field) when it has no explicit
 * profile id from the URL or a remembered one in localStorage. In normal
 * operation this returns at most one profile's packs, since logout clears
 * a profile's packs once fully synced (V2-07 §24); this is never used to
 * decide authorization, only which already-local data to display. */
export async function listAllPacks(): Promise<OfflinePack[]> {
  const db = await openOfflineDb();
  return db.getAll("packs");
}

/** Deletes only the pack record itself. Callers are responsible for
 * checking for pending/conflicted outbox operations first and getting
 * explicit destructive confirmation (V2-07 §23) - this function never
 * cascades, so an outbox entry always survives its pack being removed. */
export async function deletePackRecord(packId: string): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("packs", packId);
  await db.delete("syncState", packId);
}

// ───────────────────────── Outbox ─────────────────────────

export async function putOperation(op: OfflineOutboxOperation): Promise<void> {
  const db = await openOfflineDb();
  await db.put("outbox", op);
}

export async function getOperation(
  operationId: string,
): Promise<OfflineOutboxOperation | undefined> {
  const db = await openOfflineDb();
  return db.get("outbox", operationId);
}

export async function listOperationsForPack(
  packId: string,
): Promise<OfflineOutboxOperation[]> {
  const db = await openOfflineDb();
  return db.getAllFromIndex("outbox", "byPack", packId);
}

export async function listOperationsForProfile(
  profileId: string,
): Promise<OfflineOutboxOperation[]> {
  const db = await openOfflineDb();
  return db.getAllFromIndex("outbox", "byProfile", profileId);
}

export async function listOperationsByStatus(
  status: OfflineOperationStatus,
  profileId?: string,
): Promise<OfflineOutboxOperation[]> {
  const db = await openOfflineDb();
  const rows = await db.getAllFromIndex("outbox", "byStatus", status);
  return profileId ? rows.filter((row) => row.profileId === profileId) : rows;
}

/** Explicit, user-confirmed discard only (V2-07 §22: "Never silently delete
 * failed/conflicted operations"). Every other transition goes through
 * `putOperation` with an updated `status`. */
export async function deleteOperation(operationId: string): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("outbox", operationId);
}

export async function countUnsyncedOperationsForProfile(
  profileId: string,
): Promise<number> {
  const rows = await listOperationsForProfile(profileId);
  return rows.filter((row) => row.status !== "SYNCED").length;
}

// ───────────────────────── Sync state ─────────────────────────

export async function getSyncState(
  packId: string,
): Promise<OfflineSyncState | undefined> {
  const db = await openOfflineDb();
  return db.get("syncState", packId);
}

export async function putSyncState(state: OfflineSyncState): Promise<void> {
  const db = await openOfflineDb();
  await db.put("syncState", state);
}

// ───────────────────────── Logout / profile isolation ─────────────────────────

/** Deletes every pack, outbox operation and sync-state row belonging to one
 * profile. Callers MUST verify there are zero unsynchronized operations for
 * that profile first (V2-07 §24) - this function does not check, so the
 * logout guard is the single place that decision is made. */
export async function clearProfileOfflineData(
  profileId: string,
): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(["packs", "outbox", "syncState"], "readwrite");

  const packs = await tx
    .objectStore("packs")
    .index("byProfile")
    .getAll(profileId);
  for (const pack of packs) {
    await tx.objectStore("packs").delete(pack.packId);
    await tx.objectStore("syncState").delete(pack.packId);
  }

  const ops = await tx
    .objectStore("outbox")
    .index("byProfile")
    .getAll(profileId);
  for (const op of ops) {
    await tx.objectStore("outbox").delete(op.operationId);
  }

  await tx.done;
}
