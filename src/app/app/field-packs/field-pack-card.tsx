"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui";
import {
  deletePackRecord,
  getPack,
  listOperationsForPack,
  putPack,
} from "@/lib/offline/db";
import type { OfflinePack } from "@/lib/offline/types";
import { buildFieldOfflinePack } from "./actions";

export function FieldPackCard({
  trialId,
  trialCode,
  trialName,
  profileId,
}: {
  trialId: string;
  trialCode: string;
  trialName: string;
  profileId: string;
}) {
  const packId = `${profileId}:${trialId}`;
  const [pack, setPack] = useState<OfflinePack | null | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  // Not a live server check - derived from whether any local outbox
  // operation for this pack has already come back as CONFIG_CHANGED, which
  // is the only evidence the client has without an extra network round
  // trip purely to ask. Refreshing the pack (which re-fetches the current
  // configuration) is what actually resolves this, not a passive check.
  const [configChanged, setConfigChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const refreshLocalState = useCallback(async () => {
    const [loaded, ops] = await Promise.all([
      getPack(packId),
      listOperationsForPack(packId),
    ]);
    setPack(loaded ?? null);
    setPendingCount(ops.filter((op) => op.status !== "SYNCED").length);
    setConfigChanged(
      ops.some(
        (op) =>
          op.status === "CONFLICT" && op.lastResultCode === "CONFIG_CHANGED",
      ),
    );
  }, [packId]);

  useEffect(() => {
    refreshLocalState().catch(() => setPack(null));
  }, [refreshLocalState]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const fresh = await buildFieldOfflinePack(trialId);
      await putPack(fresh);
      await refreshLocalState();
    } catch {
      setError(
        "Impossible de préparer cet essai pour le terrain. Vérifiez votre connexion et réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deletePackRecord(packId);
      await refreshLocalState();
      setConfirmingRemove(false);
    } catch {
      setError("Impossible de supprimer les données hors ligne de cet essai.");
    } finally {
      setBusy(false);
    }
  }

  if (pack === undefined) {
    return (
      <p className="chart-description">Vérification des données hors ligne…</p>
    );
  }

  return (
    <div className="field-pack-card">
      {pack ? (
        <>
          <p className="offline-status">
            <StatusBadge tone="success">Disponible hors ligne</StatusBadge>
            {pendingCount > 0 ? (
              <StatusBadge tone="warning">
                {pendingCount} en attente de synchronisation
              </StatusBadge>
            ) : null}
            {configChanged ? (
              <StatusBadge tone="danger">
                Configuration modifiée depuis la préparation
              </StatusBadge>
            ) : null}
          </p>
          <p className="chart-description">
            Préparé le{" "}
            {new Date(pack.snapshotCreatedAt).toLocaleString("fr-FR")}
            {" · "}
            {pack.entries.length} phénotype(s) · {pack.activeTraits.length}{" "}
            trait(s) actif(s)
          </p>
        </>
      ) : (
        <p className="chart-description">
          <StatusBadge tone="neutral">Non disponible hors ligne</StatusBadge>
        </p>
      )}

      {error ? (
        <p role="alert" className="offline-card-error">
          {error}
        </p>
      ) : null}

      <div className="field-pack-actions">
        <button type="button" onClick={prepare} disabled={busy}>
          {pack
            ? "Actualiser les données hors ligne"
            : "Rendre disponible hors ligne"}
        </button>
        {pack ? (
          <Link className="button-link secondary" href="/field">
            Ouvrir l’espace terrain
          </Link>
        ) : null}
        {pack && !confirmingRemove ? (
          <button
            type="button"
            className="quiet danger"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
          >
            Supprimer les données hors ligne
          </button>
        ) : null}
      </div>

      {confirmingRemove ? (
        <div
          className="field-pack-confirm"
          role="alertdialog"
          aria-label="Confirmer la suppression"
        >
          {pendingCount > 0 ? (
            <p role="alert">
              {pendingCount} évaluation(s) saisie(s) hors ligne pour «{" "}
              {trialName} » ({trialCode}) n’ont pas encore été synchronisées.
              Les supprimer maintenant effacerait ces observations avant
              qu’elles n’atteignent le serveur.
            </p>
          ) : (
            <p>
              Supprimer les données hors ligne de « {trialName} » ({trialCode})
              ? Cette action n’efface aucune donnée déjà synchronisée sur le
              serveur.
            </p>
          )}
          <div className="field-pack-actions">
            <button
              type="button"
              className="danger"
              onClick={remove}
              disabled={busy}
            >
              {pendingCount > 0
                ? "Supprimer quand même (perte des évaluations en attente)"
                : "Confirmer la suppression"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
