import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMetObservationDataset,
  detectMetLongitudinalAmbiguity,
  toMetFingerprintRows,
} from "@/lib/met/dataset";
import { datasetFingerprint } from "@/lib/analytics/fingerprint";
import type {
  BreedingCandidateRecord,
  BreedingCandidateTraitMatrix,
  BreedingMatrixCell,
  BreedingScenarioTraitSpec,
  BreedingSourceType,
} from "./types";
import { evidenceLevelForSource, weakestEvidenceLevel } from "./types";

/** The one server-side candidate reader every V2-06 scenario starts
 * from, mirroring buildMetObservationDataset's role for V2-05 - calls
 * the RLS-scoped breeding_candidate_pool() SQL function (migration
 * 000033). Always returns every trial_entry; the scenario's own
 * candidate_eligibility decides, in TypeScript, whether to act on
 * operationallyEliminated (never silently, task review §32). */
export async function fetchBreedingCandidatePool(
  client: SupabaseClient,
  trialId: string,
): Promise<BreedingCandidateRecord[]> {
  const { data, error } = await client.rpc("breeding_candidate_pool", {
    target_trial_id: trialId,
  });
  if (error || !data) return [];
  type RpcRow = {
    trial_entry_id: string;
    code: string;
    label: string;
    scientific_role: BreedingCandidateRecord["candidateScientificRole"];
    operationally_eliminated: boolean;
  };
  return (data as RpcRow[]).map((row) => ({
    candidateId: row.trial_entry_id,
    candidateCode: row.code,
    candidateLabel: row.label,
    candidateScientificRole: row.scientific_role,
    operationallyEliminated: row.operationally_eliminated,
  }));
}

export type TraitResolutionFailure = {
  traitId: string;
  reason: string;
};

export type TraitResolutionResult =
  | { status: "ok"; values: Map<string, number> }
  | { status: "failed"; reason: string };

export type MetSourceRunValidation =
  | { status: "ok"; result: Record<string, unknown> }
  | { status: "failed"; reason: string };

/** Loads a V2-05 `multi_environment` source run and validates it is safe
 * to consume as MET_ENTRY_PREDICTION/WAASBY_STABILITY_PERFORMANCE
 * evidence (independent-review hardening #1/#2, PR #15). Database-level
 * scope (migration 000034's trigger) already rejects a source_run_id
 * that was never for this exact program/trial/trait at the moment a
 * scenario trait row is written - this function independently
 * re-validates the same invariants at READ time (never relying solely on
 * the trigger having run once in the past: the DB check cannot catch a
 * run that becomes stale AFTER it was validly attached), plus two checks
 * no trigger can perform at all:
 *
 *  - staleness: a completed V2-05 run is not current forever. The
 *    underlying raw observations it was built from may have changed
 *    since. This recomputes the CURRENT dataset fingerprint from the
 *    source run's own stored `specification` (trialId/traitId/
 *    evaluationDate - never the caller's current values, which could
 *    differ from what the run actually used) via the exact same
 *    canonical V2-05 fetch + fingerprint logic
 *    (`buildMetObservationDataset` + `toMetFingerprintRows` +
 *    `datasetFingerprint`, src/lib/met/dataset.ts /
 *    src/lib/analytics/fingerprint.ts - the same functions
 *    met-actions.ts's own save path used to compute it originally), and
 *    compares it to the persisted `dataset_fingerprint`. A mismatch means
 *    SOURCE_RUN_STALE - refused, never silently consumed.
 *  - measurement-occasion compatibility: when `requireExactOccasionMatch`
 *    is set (WAASBY_STABILITY_PERFORMANCE/MTSI only - see
 *    buildMtsiRawDataset, which refits raw observations using the
 *    SCENARIO TRAIT's own evaluationDate), the scenario trait's
 *    evaluationDate must equal the source run's own stored
 *    specification.evaluationDate exactly (both null, or the identical
 *    date) - otherwise a WAASB run computed on one occasion (e.g. D10)
 *    could be used to validate eligibility while MTSI silently refits on
 *    a DIFFERENT occasion's raw rows (e.g. D20). MET_ENTRY_PREDICTION
 *    never refetches raw rows (it reads the stored BLUP directly), so
 *    this check does not apply there. */
async function loadAndValidateMetSourceRun(
  client: SupabaseClient,
  params: {
    sourceRunId: string;
    trialId: string;
    traitId: string;
    modelType: "met_base_v1" | "met_waasb_v1";
    requireExactOccasionMatch: boolean;
    scenarioEvaluationDate: string | null;
  },
): Promise<MetSourceRunValidation> {
  const { data, error } = await client
    .from("analytics_runs")
    .select(
      "id,trial_id,trait_id,analysis_type,status,result,specification,dataset_fingerprint",
    )
    .eq("id", params.sourceRunId)
    .maybeSingle();
  if (error || !data) {
    return {
      status: "failed",
      reason:
        "La source analytics_runs indiquée est introuvable ou inaccessible.",
    };
  }
  const row = data as Record<string, unknown>;
  if (
    row.analysis_type !== "multi_environment" ||
    row.trial_id !== params.trialId
  ) {
    return {
      status: "failed",
      reason:
        "La source indiquée n'est pas une analyse multi-environnement de ce même essai.",
    };
  }
  if (row.trait_id !== params.traitId) {
    return {
      status: "failed",
      reason:
        "La source indiquée a été calculée pour un trait différent de celui de ce trait de scénario.",
    };
  }
  if (row.status !== "completed") {
    return {
      status: "failed",
      reason: `La source indiquée n'a pas le statut "completed" (statut actuel : ${String(row.status)}).`,
    };
  }
  const result = row.result as Record<string, unknown> | null;
  if (!result || result.model_type !== params.modelType) {
    return {
      status: "failed",
      reason: `La source indiquée n'est pas un résultat de type ${params.modelType}.`,
    };
  }

  const specification = row.specification as Record<string, unknown> | null;
  const specTrialId = specification?.trialId;
  const specTraitId = specification?.traitId;
  const specModelType = specification?.modelType;
  const specEvaluationDate = (specification?.evaluationDate ?? null) as
    | string
    | null;
  if (
    specTrialId !== params.trialId ||
    specTraitId !== params.traitId ||
    specModelType !== params.modelType
  ) {
    return {
      status: "failed",
      reason:
        "La spécification enregistrée de la source ne correspond pas à l'essai/trait/modèle attendu.",
    };
  }
  if (
    params.requireExactOccasionMatch &&
    specEvaluationDate !== params.scenarioEvaluationDate
  ) {
    return {
      status: "failed",
      reason:
        "L'occasion de mesure (date) de ce trait de scénario ne correspond pas à celle utilisée par l'analyse WAASB source - une analyse MTSI ne peut pas combiner une source calculée sur une occasion de mesure différente.",
    };
  }

  const discovery = await buildMetObservationDataset(client, {
    trialId: params.trialId,
    traitId: params.traitId,
    includeArchived: false,
    evaluationDate: specEvaluationDate,
  });
  if (discovery.tooLarge) {
    return {
      status: "failed",
      reason:
        "Impossible de vérifier que la source n'est pas périmée : le jeu de données sous-jacent dépasse la taille prise en charge.",
    };
  }
  const currentFingerprint = datasetFingerprint(
    toMetFingerprintRows(discovery.rows, params.traitId),
  );
  if (currentFingerprint !== row.dataset_fingerprint) {
    return {
      status: "failed",
      reason:
        "SOURCE_RUN_STALE : les observations source ont changé depuis que cette analyse multi-environnement a été calculée. Relancez l'analyse source avant de l'utiliser dans une décision d'amélioration.",
    };
  }

  return { status: "ok", result };
}

/** A trait value read from an already-stored, independently-validated
 * V2-05 analytics_runs row (loadAndValidateMetSourceRun above) - never
 * re-derives anything, never calls the R engine again. */
async function resolveFromMetRun(
  client: SupabaseClient,
  sourceRunId: string,
  trialId: string,
  traitId: string,
  modelType: "met_base_v1" | "met_waasb_v1",
  extract: (entry: Record<string, unknown>) => number | null,
): Promise<TraitResolutionResult> {
  const validation = await loadAndValidateMetSourceRun(client, {
    sourceRunId,
    trialId,
    traitId,
    modelType,
    requireExactOccasionMatch: false,
    scenarioEvaluationDate: null,
  });
  if (validation.status === "failed") return validation;
  const result = validation.result;
  const key = modelType === "met_base_v1" ? "entry_predictions" : "entries";
  const entries = Array.isArray(result[key]) ? (result[key] as unknown[]) : [];
  const values = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const entryId = record.entry_id;
    if (typeof entryId !== "string") continue;
    const value = extract(record);
    if (value !== null) values.set(entryId, value);
  }
  return { status: "ok", values };
}

/** Resolves one scenario trait's candidate values, dispatching on its
 * source_type. RAW_PHENOTYPIC/PHENOTYPIC_MEAN read directly from
 * met_observation_dataset() (V2-05's own canonical reader - never a
 * parallel query), reusing its exact longitudinal-occasion-ambiguity
 * guard (task review §8/§14): repeated dated measurements of the same
 * candidate are never silently averaged across occasions unless the
 * scenario trait explicitly pins one evaluation_date. */
export async function resolveBreedingTraitValues(
  client: SupabaseClient,
  trialId: string,
  spec: BreedingScenarioTraitSpec,
): Promise<TraitResolutionResult> {
  if (
    spec.sourceType === "RAW_PHENOTYPIC" ||
    spec.sourceType === "PHENOTYPIC_MEAN"
  ) {
    const dataset = await buildMetObservationDataset(client, {
      trialId,
      traitId: spec.traitId,
      includeArchived: false,
      evaluationDate: spec.evaluationDate,
    });
    if (dataset.tooLarge) {
      return {
        status: "failed",
        reason:
          "Le jeu de données brut de ce trait dépasse la taille prise en charge.",
      };
    }
    if (!spec.evaluationDate) {
      const ambiguity = detectMetLongitudinalAmbiguity(dataset.rows);
      if (ambiguity.ambiguous) {
        return {
          status: "failed",
          reason:
            "Des mesures longitudinales répétées ont été détectées pour la même unité biologique sur ce trait. Sélectionnez une occasion de mesure (date) avant de l'utiliser dans une décision d'amélioration.",
        };
      }
    }
    const byEntry = new Map<string, number[]>();
    for (const row of dataset.rows) {
      const list = byEntry.get(row.entryId) ?? [];
      list.push(row.numericValue);
      byEntry.set(row.entryId, list);
    }
    if (spec.sourceType === "RAW_PHENOTYPIC") {
      const ambiguousEntries = [...byEntry.entries()].filter(
        ([, values]) => values.length > 1,
      );
      if (ambiguousEntries.length > 0) {
        return {
          status: "failed",
          reason: `RAW_PHENOTYPIC exige exactement une observation par candidat ; ${ambiguousEntries.length} candidat(s) en ont plusieurs. Utilisez PHENOTYPIC_MEAN ou restreignez la portée (occasion/environnement).`,
        };
      }
      const values = new Map<string, number>();
      for (const [entryId, list] of byEntry) values.set(entryId, list[0]);
      return { status: "ok", values };
    }
    const values = new Map<string, number>();
    for (const [entryId, list] of byEntry) {
      values.set(entryId, list.reduce((a, b) => a + b, 0) / list.length);
    }
    return { status: "ok", values };
  }

  if (!spec.sourceRunId) {
    return {
      status: "failed",
      reason: `${spec.sourceType} nécessite une analyse source (source_run_id).`,
    };
  }

  if (spec.sourceType === "MET_ENTRY_PREDICTION") {
    return resolveFromMetRun(
      client,
      spec.sourceRunId,
      trialId,
      spec.traitId,
      "met_base_v1",
      (entry) => (typeof entry.blup === "number" ? entry.blup : null),
    );
  }
  if (spec.sourceType === "WAASBY_STABILITY_PERFORMANCE") {
    return resolveFromMetRun(
      client,
      spec.sourceRunId,
      trialId,
      spec.traitId,
      "met_waasb_v1",
      (entry) => (typeof entry.waasby === "number" ? entry.waasby : null),
    );
  }

  return {
    status: "failed",
    reason: `${spec.sourceType} n'est pas encore pris en charge par cette version de BreedOps.`,
  };
}

export type MtsiRawRow = {
  entry_id: string;
  environment_id: string;
  /** The true experimental-unit identity (one MET observation row = one
   * physical phenotype) - the join key the R pivot now keys on (task
   * review hardening #6), never `(entry_id, environment_id, block)`:
   * when block is absent for every row (common for an unblocked design),
   * that triple collapses to the same key for every replicate of a
   * cell, and a merge() on it degenerates into a cartesian product
   * across traits (every trait-A replicate paired with every trait-B
   * replicate, in whatever order postgres/R happened to return them -
   * never a real correspondence). phenotype_id is globally unique and
   * identifies one biological unit regardless of whether block is set,
   * so merging on it alone is always exactly 1:1, never many-to-many. */
  phenotype_id: string;
  block: string | null;
  trait_id: string;
  value: number;
};

export type MtsiRawDatasetResult =
  | {
      status: "ok";
      rows: MtsiRawRow[];
      performanceWeight: number;
      /** Candidates removed by the scenario's own candidate_eligibility
       * policy (task review hardening #4) - always disclosed, never a
       * silent filter; persisted into the run's own result/specification
       * by the caller. */
      excludedCandidates: BreedingCandidateRecord[];
    }
  | { status: "failed"; reason: string };

/** Builds the raw, long-format multi-trait dataset selection_mtsi_v1
 * needs to refit metan::waasb() itself (task review §18) - never reused
 * from an already-stored V2-05 result object, since metan::mtsi() needs
 * a real waasb-class fit, not a JSON summary of one. Every selected
 * trait is read via met_observation_dataset() (V2-05's own canonical
 * reader, migration 000028/000031), with the same longitudinal-occasion-
 * ambiguity guard RAW_PHENOTYPIC/PHENOTYPIC_MEAN already use.
 *
 * Every trait's source_run_id must point to a SUCCESSFUL, NON-STALE
 * V2-05 met_waasb_v1 run for this exact trial/trait, computed on the
 * exact same measurement occasion as this trait's own evaluationDate
 * (loadAndValidateMetSourceRun - task review hardening #1/#2), and every
 * one of those runs' own performance_weight must be identical -
 * harmonized, never silently averaged or left to diverge (task review
 * §19).
 *
 * The scenario's own candidate_eligibility policy (task review hardening
 * #4) is applied to the canonical candidate pool BEFORE any raw
 * observation is kept: an operationally-eliminated candidate, under
 * `exclude_operationally_eliminated`, never reaches the R engine's input
 * and can therefore never reappear in the MTSI ranking - the same
 * guarantee MGIDI's buildCandidateTraitMatrix already provides, extended
 * to MTSI's separate raw-row path. */
export async function buildMtsiRawDataset(
  client: SupabaseClient,
  params: {
    trialId: string;
    candidateEligibility: "all" | "exclude_operationally_eliminated";
    traits: BreedingScenarioTraitSpec[];
  },
): Promise<MtsiRawDatasetResult> {
  const { trialId, traits } = params;
  const nonWaasby = traits.filter(
    (t) => t.sourceType !== "WAASBY_STABILITY_PERFORMANCE",
  );
  if (nonWaasby.length > 0) {
    return {
      status: "failed",
      reason: `Le MTSI nécessite que chaque trait sélectionné provienne d'une source WAASBY_STABILITY_PERFORMANCE (une analyse met_waasb_v1 réussie) : ${nonWaasby.map((t) => t.traitCode).join(", ")} n'en a pas.`,
    };
  }

  const pool = await fetchBreedingCandidatePool(client, trialId);
  const excludedCandidates =
    params.candidateEligibility === "exclude_operationally_eliminated"
      ? pool.filter((c) => c.operationallyEliminated)
      : [];
  const eligibleEntryIds = new Set(
    (params.candidateEligibility === "exclude_operationally_eliminated"
      ? pool.filter((c) => !c.operationallyEliminated)
      : pool
    ).map((c) => c.candidateId),
  );
  if (eligibleEntryIds.size === 0) {
    return {
      status: "failed",
      reason:
        "Aucun candidat disponible pour cet essai avec cette politique d'éligibilité.",
    };
  }

  const performanceWeights: number[] = [];
  const allRows: MtsiRawRow[] = [];

  for (const trait of traits) {
    if (!trait.sourceRunId) {
      return {
        status: "failed",
        reason: `Le trait ${trait.traitCode} n'a pas d'analyse source (source_run_id).`,
      };
    }
    const validation = await loadAndValidateMetSourceRun(client, {
      sourceRunId: trait.sourceRunId,
      trialId,
      traitId: trait.traitId,
      modelType: "met_waasb_v1",
      requireExactOccasionMatch: true,
      scenarioEvaluationDate: trait.evaluationDate,
    });
    if (validation.status === "failed") {
      return {
        status: "failed",
        reason: `Trait ${trait.traitCode} : ${validation.reason}`,
      };
    }
    const model = validation.result.model as
      | Record<string, unknown>
      | undefined;
    const performanceWeight = model?.performance_weight;
    if (typeof performanceWeight !== "number") {
      return {
        status: "failed",
        reason: `La source du trait ${trait.traitCode} n'expose pas de pondération performance/stabilité.`,
      };
    }
    performanceWeights.push(performanceWeight);

    const dataset = await buildMetObservationDataset(client, {
      trialId,
      traitId: trait.traitId,
      includeArchived: false,
      evaluationDate: trait.evaluationDate,
    });
    if (dataset.tooLarge) {
      return {
        status: "failed",
        reason: `Le jeu de données brut du trait ${trait.traitCode} dépasse la taille prise en charge.`,
      };
    }
    if (!trait.evaluationDate) {
      const ambiguity = detectMetLongitudinalAmbiguity(dataset.rows);
      if (ambiguity.ambiguous) {
        return {
          status: "failed",
          reason: `Des mesures longitudinales répétées ont été détectées pour le trait ${trait.traitCode}. Sélectionnez une occasion de mesure avant de l'utiliser dans un MTSI.`,
        };
      }
    }
    for (const r of dataset.rows) {
      if (!eligibleEntryIds.has(r.entryId)) continue;
      allRows.push({
        entry_id: r.entryId,
        environment_id: r.environmentId,
        phenotype_id: r.phenotypeId,
        block: r.block,
        trait_id: trait.traitId,
        value: r.numericValue,
      });
    }
  }

  const distinctWeights = new Set(performanceWeights.map((w) => w.toFixed(6)));
  if (distinctWeights.size > 1) {
    return {
      status: "failed",
      reason: `Les traits sélectionnés n'ont pas tous la même pondération performance/stabilité (WAASBY) : ${performanceWeights.join(", ")}. Harmonisez les analyses sources avant de lancer un MTSI.`,
    };
  }

  return {
    status: "ok",
    rows: allRows,
    performanceWeight: performanceWeights[0],
    excludedCandidates,
  };
}

export type BreedingMatrixBuildResult =
  | { status: "ok"; matrix: BreedingCandidateTraitMatrix }
  | { status: "failed"; reason: string; traitId?: string };

/** The ONE canonical candidate x trait matrix builder every V2-06
 * selection method is built from (task review §11) - no method
 * reconstructs its own. candidateEligibility='exclude_operationally_eliminated'
 * removes operationally-eliminated candidates from the POOL itself
 * (never a silent default); the exclusion is always visible via the
 * returned candidate list's own operationallyEliminated flag history is
 * not kept here - callers that need "who was excluded and why" read it
 * from excludedCandidates. */
export async function buildCandidateTraitMatrix(
  client: SupabaseClient,
  params: {
    trialId: string;
    candidateEligibility: "all" | "exclude_operationally_eliminated";
    traits: BreedingScenarioTraitSpec[];
  },
): Promise<
  BreedingMatrixBuildResult & {
    excludedCandidates?: BreedingCandidateRecord[];
  }
> {
  // Hardening #7 (independent review, PR #15): WAASBY is already a
  // derived performance/stability desirability index (metan::waasb()'s
  // own mresp argument decides whether high or low response is
  // desirable when the stored met_waasb_v1 run was computed) - V2-05
  // does not persist a sufficiently explicit response-direction contract
  // to safely reinterpret it as a raw point value for MGIDI's own
  // direction/ideotype (which is independently chosen per scenario
  // trait, and could silently double-orient the data). Conservative
  // rule for this PR: WAASBY_STABILITY_PERFORMANCE is valid evidence for
  // MTSI (buildMtsiRawDataset) only, never for MGIDI's candidate x trait
  // matrix. See docs/BREEDING_DECISION_ANALYTICS.md §7 for the full
  // rationale and what would be required to lift this restriction.
  const waasbyTraits = params.traits.filter(
    (t) => t.sourceType === "WAASBY_STABILITY_PERFORMANCE",
  );
  if (waasbyTraits.length > 0) {
    return {
      status: "failed",
      reason: `WAASBY_STABILITY_PERFORMANCE n'est pas une source valide pour le MGIDI (uniquement pour le MTSI) : ${waasbyTraits.map((t) => t.traitCode).join(", ")}. C'est un indice de performance/stabilité déjà orienté par metan::waasb(), pas une valeur brute réutilisable comme point candidat x trait.`,
      traitId: waasbyTraits[0].traitId,
    };
  }

  const pool = await fetchBreedingCandidatePool(client, params.trialId);
  const excludedCandidates =
    params.candidateEligibility === "exclude_operationally_eliminated"
      ? pool.filter((c) => c.operationallyEliminated)
      : [];
  const candidates =
    params.candidateEligibility === "exclude_operationally_eliminated"
      ? pool.filter((c) => !c.operationallyEliminated)
      : pool;

  if (candidates.length === 0) {
    return {
      status: "failed",
      reason:
        "Aucun candidat disponible pour cet essai avec cette politique d'éligibilité.",
    };
  }

  const cells: BreedingMatrixCell[] = [];
  const evidenceLevels: ReturnType<typeof evidenceLevelForSource>[] = [];
  for (const spec of params.traits) {
    const resolution = await resolveBreedingTraitValues(
      client,
      params.trialId,
      spec,
    );
    if (resolution.status === "failed") {
      return {
        status: "failed",
        reason: resolution.reason,
        traitId: spec.traitId,
      };
    }
    evidenceLevels.push(evidenceLevelForSource(spec.sourceType));
    for (const candidate of candidates) {
      cells.push({
        candidateId: candidate.candidateId,
        traitId: spec.traitId,
        value: resolution.values.get(candidate.candidateId) ?? null,
      });
    }
  }

  const missingCells = cells.filter((c) => c.value === null).length;
  const traitIds = params.traits.map((t) => t.traitId);
  const completeCandidateCount = candidates.filter((c) =>
    traitIds.every(
      (traitId) =>
        cells.find(
          (cell) =>
            cell.candidateId === c.candidateId && cell.traitId === traitId,
        )?.value !== null,
    ),
  ).length;

  const matrix: BreedingCandidateTraitMatrix = {
    candidates,
    traits: params.traits,
    cells,
    evidenceLevel:
      evidenceLevels.length > 0
        ? weakestEvidenceLevel(evidenceLevels)
        : "PHENOTYPIC",
    coverage: {
      candidateCount: candidates.length,
      traitCount: params.traits.length,
      completeCandidateCount,
      missingCells,
      coverage:
        candidates.length > 0 ? completeCandidateCount / candidates.length : 0,
    },
  };

  return { status: "ok", matrix, excludedCandidates };
}

export type { BreedingSourceType };
