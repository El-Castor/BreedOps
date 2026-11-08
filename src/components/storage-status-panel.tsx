"use client";

import { useEffect, useState } from "react";
import {
  getStorageStatus,
  requestPersistentStorage,
  type StorageStatusResult,
} from "@/lib/offline/storage-status";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Storage durability panel (V2-07 §9) - shown once on the offline pack
 * management screen (/app/field-packs), not per pack, since
 * navigator.storage is origin-wide, not pack-scoped. Never claims
 * persistence was granted unless the browser's own persist() call
 * actually returned true. */
export function StorageStatusPanel() {
  const [status, setStatus] = useState<StorageStatusResult | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    void getStorageStatus().then(setStatus);
  }, []);

  async function handleRequestPersist() {
    setRequesting(true);
    try {
      await requestPersistentStorage();
      setStatus(await getStorageStatus());
    } finally {
      setRequesting(false);
    }
  }

  if (!status || !status.supported) return null;

  return (
    <div className="storage-status-panel">
      <p className="chart-description">
        Stockage hors ligne utilisé : {formatBytes(status.usageBytes)}
        {status.quotaBytes !== null
          ? ` sur ${formatBytes(status.quotaBytes)} disponibles dans ce navigateur`
          : null}
        {" · "}
        {status.persisted === true
          ? "Stockage persistant accordé"
          : status.persisted === false
            ? "Stockage au mieux (le navigateur peut l'effacer sous pression mémoire)"
            : "État de persistance inconnu"}
      </p>
      {status.persisted === false ? (
        <button
          type="button"
          className="quiet"
          onClick={handleRequestPersist}
          disabled={requesting}
        >
          Demander un stockage persistant
        </button>
      ) : null}
    </div>
  );
}
