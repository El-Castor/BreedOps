"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import {
  getPack,
  listAllPacks,
  listOperationsForPack,
  listPacksForProfile,
  putOperation,
} from "@/lib/offline/db";
import { buildPhenotypeEvaluationOperation } from "@/lib/offline/outbox";
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
        setSelectedPackId((current) => current ?? loaded[0]?.packId ?? null);
      }
      setLoading(false);
    })();
  }, [initialProfileId]);

  const selectedPack = useMemo(
    () => packs.find((p) => p.packId === selectedPackId) ?? null,
    [packs, selectedPackId],
  );

  useEffect(() => {
    if (!selectedPackId) {
      setOutbox([]);
      return;
    }
    listOperationsForPack(selectedPackId).then(setOutbox);
  }, [selectedPackId]);

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
      const refreshed = selectedPackId
        ? await listOperationsForPack(selectedPackId)
        : [];
      setOutbox(refreshed);
      resetForm();
      setMessage(
        "Évaluation enregistrée localement, en attente de synchronisation.",
      );
    } finally {
      setSaving(false);
    }
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

  const pendingCount = outbox.filter((op) => op.status !== "SYNCED").length;

  return (
    <div className="field-workspace">
      <p className="offline-status" aria-live="polite">
        <span
          className={`status-dot ${online ? "status-dot-ok" : "status-dot-warn"}`}
          aria-hidden="true"
        />
        {online ? "En ligne" : "Hors ligne"}
        {" · "}
        {pendingCount > 0
          ? `${pendingCount} évaluation(s) en attente de synchronisation`
          : "Synchronisé"}
      </p>

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
        <h3 className="chart-title">Synchronisation en attente</h3>
        {outbox.length === 0 ? (
          <p className="chart-description">Aucune évaluation en attente.</p>
        ) : (
          <ul className="field-entry-list">
            {outbox
              .slice()
              .sort((a, b) =>
                b.createdAtClient.localeCompare(a.createdAtClient),
              )
              .map((op) => (
                <li key={op.operationId}>
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
                  {op.lastError ? (
                    <span className="field-trait-error">{op.lastError}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
