"use client";

import { useState } from "react";

export type BreedingDecisionTraitOption = { traitId: string; name: string };
export type BreedingDecisionMetRunOption = {
  id: string;
  traitId: string;
  traitName: string;
  modelType: "met_base_v1" | "met_waasb_v1";
  createdAt: string;
};

const sourceTypeLabels: Record<string, string> = {
  RAW_PHENOTYPIC: "Observation brute",
  PHENOTYPIC_MEAN: "Moyenne phénotypique",
  MET_ENTRY_PREDICTION: "Prédiction d’entrée (met_base_v1)",
  WAASBY_STABILITY_PERFORMANCE: "Performance/stabilité WAASBY (met_waasb_v1)",
};

/** The "Trait" / "Source de la valeur" / "Analyse source" fields of the
 * add-scenario-trait form, kept together in one client component so the
 * "Analyse source" dropdown can be filtered live as the breeder picks a
 * trait and a source type - task review hardening #8: a source-run
 * dropdown must only ever offer runs for the ACTUAL selected trait (and
 * the model type the chosen source_type requires), never every
 * met_base_v1/met_waasb_v1 run in the trial. This is UX defense-in-depth
 * only - the DB trigger (migration 000034) and the application-layer
 * validation (loadAndValidateMetSourceRun) remain the actual security
 * boundary and reject a mismatch regardless of what this component ever
 * renders. */
export function BreedingDecisionSourceFields({
  traits,
  metBaseRuns,
  metWaasbRuns,
}: {
  traits: BreedingDecisionTraitOption[];
  metBaseRuns: BreedingDecisionMetRunOption[];
  metWaasbRuns: BreedingDecisionMetRunOption[];
}) {
  const [traitId, setTraitId] = useState(traits[0]?.traitId ?? "");
  const [sourceType, setSourceType] = useState("RAW_PHENOTYPIC");

  const candidateRuns =
    sourceType === "MET_ENTRY_PREDICTION"
      ? metBaseRuns
      : sourceType === "WAASBY_STABILITY_PERFORMANCE"
        ? metWaasbRuns
        : [];
  const filteredRuns = candidateRuns.filter((r) => r.traitId === traitId);
  const needsSourceRun =
    sourceType === "MET_ENTRY_PREDICTION" ||
    sourceType === "WAASBY_STABILITY_PERFORMANCE";

  return (
    <>
      <label>
        Trait
        <select
          name="trait_id"
          required
          value={traitId}
          onChange={(e) => setTraitId(e.target.value)}
        >
          {traits.map((t) => (
            <option key={t.traitId} value={t.traitId}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source de la valeur
        <select
          name="source_type"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
        >
          <option value="RAW_PHENOTYPIC">
            {sourceTypeLabels.RAW_PHENOTYPIC}
          </option>
          <option value="PHENOTYPIC_MEAN">
            {sourceTypeLabels.PHENOTYPIC_MEAN}
          </option>
          <option value="MET_ENTRY_PREDICTION">
            {sourceTypeLabels.MET_ENTRY_PREDICTION}
          </option>
          <option value="WAASBY_STABILITY_PERFORMANCE">
            {sourceTypeLabels.WAASBY_STABILITY_PERFORMANCE}
          </option>
        </select>
      </label>
      <label>
        Analyse source (si prédiction/WAASBY)
        <select name="source_run_id" disabled={!needsSourceRun}>
          <option value="">—</option>
          {filteredRuns.map((r) => (
            <option key={r.id} value={r.id}>
              {r.modelType} · {r.traitName} ·{" "}
              {new Date(r.createdAt).toLocaleDateString("fr-FR")}
            </option>
          ))}
        </select>
        {needsSourceRun && filteredRuns.length === 0 && (
          <span className="field-hint">
            Aucune analyse{" "}
            {sourceType === "MET_ENTRY_PREDICTION"
              ? "met_base_v1"
              : "met_waasb_v1"}{" "}
            réussie pour ce trait dans cet essai.
          </span>
        )}
      </label>
    </>
  );
}
