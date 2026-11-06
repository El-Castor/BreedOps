"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import {
  deleteOperation,
  listAllPacks,
  listOperationsForPack,
  listPacksForProfile,
  putOperation,
} from "@/lib/offline/db";
import {
  buildPhenotypeEvaluationOperation,
  markPendingRetry,
} from "@/lib/offline/outbox";
import {
  listenForBackgroundSyncMessages,
  registerBackgroundSync,
  syncPendingOperations,
} from "@/lib/offline/sync";
import { validateTraitValue } from "@/lib/offline/trait-validation";
import type {
  OfflineOutboxOperation,
  OfflinePack,
  OfflinePhenotypeEntry,
  OfflineTraitDefinition,
} from "@/lib/offline/types";

const ACTIVE_PROFILE_KEY = "breedops-offline-active-profile";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

async function resolveProfileId(
  fromUrl: string | null,
): Promise<string | null> {
  if (fromUrl) {
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, fromUrl);
    } catch {
      /* best-effort only - see docs/OFFLINE_PWA.md's local-storage trust model */
    }
    return fromUrl;
  }
  try {
    const remembered = localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (remembered) return remembered;
  } catch {
    /* ignore - localStorage may be unavailable (private browsing, quota) */
  }
  const packs = await listAllPacks();
  return packs[0]?.profileId ?? null;
}

function TraitField({
  trait,
  value,
  error,
  onChange,
}: {
  trait: OfflineTraitDefinition;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const label = `${trait.name}${trait.unit ? ` (${trait.unit})` : ""}`;
  const fieldId = `trait-${trait.code}`;
  return (
    <label htmlFor={fieldId} className="field-trait-input">
      <span>{label}</span>
      {trait.dataType === "boolean" ? (
        <input
          id={fieldId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : trait.dataType === "categorical" ? (
        <select
          id={fieldId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(trait.allowedValues ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : trait.dataType === "date" ? (
        <input
          id={fieldId}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : trait.dataType === "numeric" ||
        trait.dataType === "integer" ||
        trait.dataType === "ordinal" ? (
        <input
          id={fieldId}
          type="number"
          inputMode="decimal"
          step={trait.dataType === "numeric" ? "any" : "1"}
          min={trait.minimumValue ?? undefined}
          max={trait.maximumValue ?? undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          id={fieldId}
          maxLength={1000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? (
        <span role="alert" className="field-trait-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function FieldWorkspace({
  initialProfileId,
}: {
  initialProfileId: string | null;
}) {
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedPhenotypeId, setSelectedPhenotypeId] = useState<string | null>(
    null,
  );
  const [evaluationDate, setEvaluationDate] = useState(todayIso());
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OfflineOutboxOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [confirmingDiscardId, setConfirmingDiscardId] = useState<string | null>(
    null,
  );

  const refreshOutbox = useCallback(async (packId: string | null) => {
    if (!packId) {
      setOutbox([]);
      return;
    }
    setOutbox(await listOperationsForPack(packId));
  }, []);

  const runSync = useCallback(
    async (currentProfileId: string, packId: string | null) => {
      if (!navigator.onLine) return;
      setSyncing(true);
      try {
        const summary = await syncPendingOperations(currentProfileId);
        setAuthRequired(summary.authRequired);
        await refreshOutbox(packId);
      } finally {
        setSyncing(false);
      }
    },
    [refreshOutbox],
  );

  // Foreground sync state machine (V2-07 §19): startup/resume (this
  // effect, once profileId resolves), the manual button below, and the
  // browser `online` event (the next effect) - all three call the same
  // syncPendingOperations(). Background Sync (effect after that) is wired
  // on top as a pure progressive enhancement that also just calls it.
  useEffect(() => {
    (async () => {
      const urlProfile = new URLSearchParams(window.location.search).get(
        "profile",
      );
      const resolved = await resolveProfileId(urlProfile ?? initialProfileId);
      setProfileId(resolved);
      if (resolved) {
        const loaded = await listPacksForProfile(resolved);
        setPacks(loaded);
        const firstPackId = loaded[0]?.packId ?? null;
        setSelectedPackId((current) => current ?? firstPackId);
        void runSync(resolved, firstPackId); // startup/resume trigger
      }
      setLoading(false);
    })();
    // runSync is stable via useCallback; only re-resolve on a new initial profile.
  }, [initialProfileId]);

  // Browser `online` event trigger (V2-07 §19) - `navigator.onLine` is only
  // a hint, but regaining it is still the right moment to attempt a sync;
  // actual success/failure is what syncPendingOperations itself decides.
  useEffect(() => {
    if (!profileId) return;
    const onOnline = () => void runSync(profileId, selectedPackId);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [profileId, selectedPackId, runSync]);

  // Background Sync progressive enhancement (V2-07 §20): registers once
  // per profile and listens for the service worker forwarding a sync
  // opportunity - both are no-ops where unsupported, and the three
  // foreground triggers above already cover durability on their own.
  useEffect(() => {
    if (!profileId) return;
    void registerBackgroundSync();
    return listenForBackgroundSyncMessages(profileId);
  }, [profileId]);

  const selectedPack = useMemo(
    () => packs.find((p) => p.packId === selectedPackId) ?? null,
    [packs, selectedPackId],
  );

  useEffect(() => {
    void refreshOutbox(selectedPackId);
  }, [selectedPackId, refreshOutbox]);

  const filteredEntries = useMemo<OfflinePhenotypeEntry[]>(() => {
    if (!selectedPack) return [];
    const q = search.trim().toLowerCase();
    if (!q) return selectedPack.entries;
    return selectedPack.entries.filter(
      (entry) =>
        entry.phenotypeCode.toLowerCase().includes(q) ||
        entry.label.toLowerCase().includes(q),
    );
  }, [selectedPack, search]);

  const selectedEntry = useMemo(
    () =>
      selectedPack?.entries.find(
        (e) => e.phenotypeId === selectedPhenotypeId,
      ) ?? null,
    [selectedPack, selectedPhenotypeId],
  );

  function resetForm() {
    setEvaluationDate(todayIso());
    setValues({});
    setFieldErrors({});
    setNotes("");
  }

  async function handleSave() {
    if (!selectedPack || !selectedEntry) return;
    setMessage(null);

    const errors: Record<string, string> = {};
    const submitted: Record<string, string | number | boolean> = {};
    for (const trait of selectedPack.activeTraits) {
      const raw = values[trait.code];
      const result = validateTraitValue(trait, raw);
      if (!result.ok) {
        errors[trait.code] = result.message ?? "Valeur invalide.";
        continue;
      }
      if (result.value !== undefined) {
        submitted[trait.code] = result.value;
      }
    }
    if (Object.keys(submitted).length === 0) {
      errors._form = "Au moins une valeur de trait est requise.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const operation = await buildPhenotypeEvaluationOperation({
        pack: selectedPack,
        phenotypeId: selectedEntry.phenotypeId,
        candidateLabel: `${selectedEntry.phenotypeCode} — ${selectedEntry.label}`,
        evaluationDate,
        values: submitted,
        notes: notes.trim() ? notes.trim() : null,
      });
      await putOperation(operation);
      await refreshOutbox(selectedPackId);
      resetForm();
      if (profileId && navigator.onLine)
        void runSync(profileId, selectedPackId);
      setMessage(
        "Évaluation enregistrée localement, en attente de synchronisation.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Manual retry for a FAILED or CONFLICT operation (V2-07 §22) - requeues
  // it as PENDING and, if online, attempts to sync immediately. Never
  // silent: the operation's attemptCount/lastError stay visible until the
  // retry itself changes them.
  async function handleRetry(op: OfflineOutboxOperation) {
    await putOperation(markPendingRetry(op));
    await refreshOutbox(selectedPackId);
    if (profileId && navigator.onLine) void runSync(profileId, selectedPackId);
  }

  // Explicit, confirmed discard only (V2-07 §22: "never silently delete
  // failed/conflicted operations") - confirmingDiscardId gates this on the
  // OutboxEntry's own confirmation step.
  async function handleDiscard(operationId: string) {
    await deleteOperation(operationId);
    setConfirmingDiscardId(null);
    await refreshOutbox(selectedPackId);
  }

  if (loading) {
    return <p className="chart-description">Chargement de l’espace terrain…</p>;
  }

  if (!profileId || packs.length === 0) {
    return (
      <EmptyState
        title="Aucun essai préparé pour le terrain"
        message="Connectez-vous en ligne, ouvrez Terrain, puis rendez un essai disponible hors ligne avant de l’utiliser ici."
        action={{ label: "Préparer un essai", href: "/app/field-packs" }}
      />
    );
  }

  // Conflicts are their own state (§21: "Conflict · N requires review"),
  // distinct from the ordinary pending backlog - a conflict is never
  // cleared by sync retrying it, only by the user reviewing it below.
  const conflictCount = outbox.filter((op) => op.status === "CONFLICT").length;
  const pendingCount = outbox.filter(
    (op) => op.status !== "SYNCED" && op.status !== "CONFLICT",
  ).length;

  return (
    <div className="field-workspace">
      <p className="offline-status" aria-live="polite">
        <span
          className={`status-dot ${
            syncing
              ? "status-dot-syncing"
              : conflictCount > 0
                ? "status-dot-danger"
                : online
                  ? pendingCount > 0
                    ? "status-dot-warn"
                    : "status-dot-ok"
                  : "status-dot-warn"
          }`}
          aria-hidden="true"
        />
        {online ? "En ligne" : "Hors ligne"}
        {" · "}
        {syncing
          ? "Synchronisation en cours…"
          : conflictCount > 0
            ? `Conflit · ${conflictCount} évaluation(s) à vérifier`
            : pendingCount > 0
              ? `${pendingCount} évaluation(s) en attente de synchronisation`
              : "Synchronisé"}
        {online && !syncing && pendingCount > 0 && profileId ? (
          <button
            type="button"
            className="quiet"
            onClick={() => void runSync(profileId, selectedPackId)}
          >
            Synchroniser maintenant
          </button>
        ) : null}
      </p>

      {authRequired ? (
        <p role="alert" className="offline-card-error">
          Votre session a expiré. <Link href="/login">Reconnectez-vous</Link>{" "}
          pour synchroniser les évaluations en attente - elles restent
          enregistrées localement jusque-là.
        </p>
      ) : null}

      {packs.length > 1 ? (
        <label>
          Essai
          <select
            value={selectedPackId ?? ""}
            onChange={(e) => {
              setSelectedPackId(e.target.value);
              setSelectedPhenotypeId(null);
              resetForm();
            }}
          >
            {packs.map((pack) => (
              <option key={pack.packId} value={pack.packId}>
                {pack.trialName} ({pack.trialCode})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h2 className="chart-title">
          {selectedPack?.trialName} ({selectedPack?.trialCode})
        </h2>
      )}

      <Card>
        <h3 className="chart-title">Rechercher un phénotype</h3>
        <input
          type="search"
          placeholder="Code ou libellé…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Rechercher un phénotype"
        />
        {filteredEntries.length === 0 ? (
          <p className="chart-description">Aucun phénotype ne correspond.</p>
        ) : (
          <ul className="field-entry-list">
            {filteredEntries.slice(0, 50).map((entry) => (
              <li key={entry.phenotypeId}>
                <button
                  type="button"
                  className={
                    entry.phenotypeId === selectedPhenotypeId ? "secondary" : ""
                  }
                  onClick={() => {
                    setSelectedPhenotypeId(entry.phenotypeId);
                    resetForm();
                  }}
                >
                  <code>{entry.phenotypeCode}</code> {entry.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selectedEntry && selectedPack ? (
        <Card>
          <h3 className="chart-title">
            Évaluation — {selectedEntry.phenotypeCode}
          </h3>
          <p className="chart-description">{selectedEntry.label}</p>
          <label>
            Date d’évaluation
            <input
              type="date"
              value={evaluationDate}
              onChange={(e) => setEvaluationDate(e.target.value)}
              required
            />
          </label>
          <div className="field-trait-grid">
            {selectedPack.activeTraits.map((trait) => (
              <TraitField
                key={trait.traitId}
                trait={trait}
                value={values[trait.code]}
                error={fieldErrors[trait.code]}
                onChange={(value) =>
                  setValues((prev) => ({ ...prev, [trait.code]: value }))
                }
              />
            ))}
          </div>
          <label>
            Notes (optionnel)
            <textarea
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {fieldErrors._form ? (
            <p role="alert" className="offline-card-error">
              {fieldErrors._form}
            </p>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <button type="button" onClick={handleSave} disabled={saving}>
            Enregistrer
          </button>
        </Card>
      ) : null}

      <Card>
        <h3 className="chart-title">File de synchronisation</h3>
        {outbox.length === 0 ? (
          <p className="chart-description">Aucune évaluation en attente.</p>
        ) : (
          <ul className="field-entry-list outbox-list">
            {outbox
              .slice()
              .sort((a, b) =>
                b.createdAtClient.localeCompare(a.createdAtClient),
              )
              .map((op) => (
                <OutboxEntry
                  key={op.operationId}
                  op={op}
                  confirmingDiscard={confirmingDiscardId === op.operationId}
                  onRequestDiscard={() =>
                    setConfirmingDiscardId(op.operationId)
                  }
                  onCancelDiscard={() => setConfirmingDiscardId(null)}
                  onDiscard={() => void handleDiscard(op.operationId)}
                  onRetry={() => void handleRetry(op)}
                />
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OutboxEntry({
  op,
  confirmingDiscard,
  onRequestDiscard,
  onCancelDiscard,
  onDiscard,
  onRetry,
}: {
  op: OfflineOutboxOperation;
  confirmingDiscard: boolean;
  onRequestDiscard: () => void;
  onCancelDiscard: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const retryable = op.status === "FAILED" || op.status === "CONFLICT";
  // SYNCED is deliberately never discardable here - it already exists on
  // the server, so "discard" would only hide a correct local record, not
  // undo anything (V2-07 §22 only covers unsynchronized operations).
  const discardable = op.status !== "SYNCED";
  return (
    <li className="outbox-entry">
      <div className="outbox-entry-header">
        {/* A scientific code, never a bare operation UUID (§22). */}
        <span>{op.candidateLabel}</span>
        <StatusBadge
          tone={
            op.status === "SYNCED"
              ? "success"
              : op.status === "CONFLICT" || op.status === "FAILED"
                ? "danger"
                : "warning"
          }
        >
          {op.status}
        </StatusBadge>
      </div>
      <p className="chart-description">
        Évaluation du {op.payload.evaluationDate} · saisie le{" "}
        {new Date(op.createdAtClient).toLocaleString("fr-FR")}
        {op.attemptCount > 0
          ? ` · ${op.attemptCount} tentative(s) de synchronisation`
          : null}
      </p>
      {op.lastError ? (
        <p role="alert" className="field-trait-error">
          {op.lastError}
        </p>
      ) : null}
      <div className="field-pack-actions">
        {retryable ? (
          <button type="button" className="secondary" onClick={onRetry}>
            Réessayer
          </button>
        ) : null}
        {discardable && !confirmingDiscard ? (
          <button
            type="button"
            className="quiet danger"
            onClick={onRequestDiscard}
          >
            Supprimer
          </button>
        ) : null}
      </div>
      {confirmingDiscard ? (
        <div className="field-pack-confirm" role="alertdialog">
          <p role="alert">
            Supprimer cette évaluation non synchronisée ? Cette observation sera
            définitivement perdue.
          </p>
          <div className="field-pack-actions">
            <button type="button" className="danger" onClick={onDiscard}>
              Confirmer la suppression
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onCancelDiscard}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
