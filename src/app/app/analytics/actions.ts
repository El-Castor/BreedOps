"use server";

import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";
import { requireIdentity } from "@/lib/auth";
import {
  buildCategoricalDataset,
  buildObservationDataset,
  countCohortEvaluations,
  deriveFilterOptions,
  listCategoricalTraits,
  listNumericTraits,
  type NumericTraitOption,
} from "@/lib/analytics/dataset";
import { computeTraitIntelligence } from "@/lib/analytics/analysis";
import { computeCategoricalSummary } from "@/lib/analytics/categorical";
import { computeTraitAssociations } from "@/lib/analytics/associations";
import { computeEarlyProxyEvidence } from "@/lib/analytics/proxy";
import { datasetFingerprint } from "@/lib/analytics/fingerprint";
import type {
  AnalyticsFilters,
  CategoricalSummary,
  EarlyProxyResult,
  TraitIntelligenceBundle,
  TraitIntelligenceResult,
} from "@/lib/analytics/types";
import { filtersFromFormData } from "./filters";

type FingerprintRow = {
  evaluationId: string;
  traitValueId: string;
  traitId: string;
  phenotypeId: string;
  evaluationDate: string | null;
  numericValue: number;
};

function toFingerprintRows(
  rows: {
    evaluationId: string;
    traitValueId: string;
    traitId: string;
    phenotypeId: string;
    evaluationDate: string | null;
    numericValue: number;
  }[],
): FingerprintRow[] {
  return rows.map((r) => ({
    evaluationId: r.evaluationId,
    traitValueId: r.traitValueId,
    traitId: r.traitId,
    phenotypeId: r.phenotypeId,
    evaluationDate: r.evaluationDate,
    numericValue: r.numericValue,
  }));
}

/** Loads (or refuses to load) the full Trait Intelligence bundle for a
 * trait/filter combination. Returns `dataset_too_large` rather than ever
 * computing statistics on a truncated prefix of a larger dataset (task
 * review finding #1) - the caller must check `status` before touching
 * `bundle`. */
export async function loadTraitIntelligence(filters: AnalyticsFilters): Promise<
  | {
      status: "ok";
      bundle: TraitIntelligenceBundle;
      rowsForFingerprint: FingerprintRow[];
    }
  | { status: "dataset_too_large" }
  | { status: "trait_not_found" }
> {
  const { client } = await requireIdentity();
  const traits = await listNumericTraits(client, filters.programId);
  const trait = traits.find((t) => t.traitId === filters.traitId);
  if (!trait) return { status: "trait_not_found" };

  const [dataset, evaluationCount] = await Promise.all([
    buildObservationDataset(client, filters, trait),
    countCohortEvaluations(client, filters),
  ]);
  // Either the trait's own observations, or the cohort's evaluation-event
  // denominator, exceeding the supported size means the true, complete
  // filtered dataset cannot be represented - refuse outright rather than
  // compute on whatever truncated preview came back.
  if (dataset.tooLarge || evaluationCount.tooLarge) {
    return { status: "dataset_too_large" };
  }

  const bundle = computeTraitIntelligence(
    dataset.rows,
    trait,
    evaluationCount.count,
  );
  bundle.associations = await computeTraitAssociations(
    client,
    filters,
    dataset.rows,
    traits,
  );

  return {
    status: "ok",
    bundle,
    rowsForFingerprint: toFingerprintRows(dataset.rows),
  };
}

export async function loadFilterOptions(
  programId: string,
  traitId: string,
  dateFrom: string | null,
  dateTo: string | null,
  includeArchived: boolean,
) {
  const { client } = await requireIdentity();
  const traits = await listNumericTraits(client, programId);
  const trait = traits.find((t) => t.traitId === traitId);
  if (!trait)
    return {
      families: [],
      seedLots: [],
      blocks: [],
      replicates: [],
      locations: [],
    };
  // Deriving dropdown choices from a best-effort preview is an acceptable
  // UX degradation even when the unfiltered dataset is too large to
  // analyze in full (dataset.ts) - this is never fed into a statistic.
  const dataset = await buildObservationDataset(
    client,
    {
      programId,
      traitId,
      dateFrom,
      dateTo,
      familyIds: null,
      seedLotIds: null,
      blocks: null,
      replicates: null,
      locations: null,
      includeArchived,
    },
    trait,
  );
  return deriveFilterOptions(dataset.rows);
}

export async function loadNumericTraitOptions(
  programId: string,
): Promise<NumericTraitOption[]> {
  const { client } = await requireIdentity();
  return listNumericTraits(client, programId);
}

/** Frequency-only summaries for every active categorical/boolean trait in
 * the program (task §5 scope completion). Each trait is evaluated
 * independently; one being DATASET_TOO_LARGE never blocks the others. */
export async function loadCategoricalSummaries(
  programId: string,
  dateFrom: string | null,
  dateTo: string | null,
  includeArchived: boolean,
): Promise<{ summaries: CategoricalSummary[]; tooLargeTraitNames: string[] }> {
  const { client } = await requireIdentity();
  const traits = await listCategoricalTraits(client, programId);
  const filters: AnalyticsFilters = {
    programId,
    traitId: "",
    dateFrom,
    dateTo,
    familyIds: null,
    seedLotIds: null,
    blocks: null,
    replicates: null,
    locations: null,
    includeArchived,
  };
  const evaluationCount = await countCohortEvaluations(client, filters);
  const summaries: CategoricalSummary[] = [];
  const tooLargeTraitNames: string[] = [];
  for (const trait of traits) {
    const dataset = await buildCategoricalDataset(client, filters, trait);
    if (dataset.tooLarge || evaluationCount.tooLarge) {
      tooLargeTraitNames.push(trait.name);
      continue;
    }
    summaries.push(
      computeCategoricalSummary(dataset.rows, trait, evaluationCount.count),
    );
  }
  return { summaries, tooLargeTraitNames };
}

export async function loadEarlyProxyEvidence(
  filters: AnalyticsFilters,
  sourceTraitId: string,
  sourceFrom: string,
  sourceTo: string,
  targetTraitId: string,
  targetFrom: string,
  targetTo: string,
): Promise<EarlyProxyResult | null> {
  const { client } = await requireIdentity();
  const traits = await listNumericTraits(client, filters.programId);
  const sourceTrait = traits.find((t) => t.traitId === sourceTraitId);
  const targetTrait = traits.find((t) => t.traitId === targetTraitId);
  if (!sourceTrait || !targetTrait) return null;
  return computeEarlyProxyEvidence(
    client,
    filters,
    { trait: sourceTrait, from: sourceFrom, to: sourceTo },
    { trait: targetTrait, from: targetFrom, to: targetTo },
  );
}

/** Caps what ever gets persisted into analytics_runs.result: a compact
 * SUMMARY, never the full per-row dataset (task §9/migration 000027's own
 * size CHECK is the hard backstop; this keeps well under it). */
function summarizeForStorage(bundle: TraitIntelligenceBundle) {
  return {
    descriptive: bundle.descriptive,
    qc: {
      bounds: bundle.qc.bounds,
      outliers: bundle.qc.outliers.slice(0, 50),
      histogram: bundle.qc.histogram,
    },
    populationTrajectory: bundle.populationTrajectory.slice(0, 200),
    rankStability: bundle.rankStability,
    repeatability: bundle.repeatability,
    heritability: bundle.heritability,
    associations: bundle.associations.slice(0, 50),
    warnings: bundle.warnings,
  };
}

export async function createAnalysisRun(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const filters = filtersFromFormData(form);
    const { client, profile } = await requireIdentity();
    const loaded = await loadTraitIntelligence(filters);
    if (loaded.status === "trait_not_found") {
      return actionError(
        new Error("trait not found"),
        "Trait introuvable pour ce programme.",
      );
    }
    if (loaded.status === "dataset_too_large") {
      return actionError(
        new Error("dataset too large"),
        "Le jeu de données filtré dépasse la taille d’analyse prise en charge. Restreignez les filtres (période, bloc, famille…) avant d’enregistrer cette analyse.",
      );
    }
    const fingerprint = datasetFingerprint(loaded.rowsForFingerprint);
    const nObserved = loaded.bundle.descriptive.nObserved;
    const status: "completed" | "not_estimable" =
      nObserved > 0 ? "completed" : "not_estimable";
    const { error } = await client.from("analytics_runs").insert({
      program_id: filters.programId,
      trait_id: filters.traitId,
      analysis_type: "trait_intelligence",
      spec_version: "1",
      specification: filters,
      dataset_fingerprint: fingerprint,
      status,
      result: summarizeForStorage(loaded.bundle),
      n_observations: nObserved,
      engine_name: "breedops-ts-stats",
      engine_version: "1.0.0",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      created_by: profile.id,
    });
    if (error) throw error;
    return actionSuccess("Analyse enregistrée avec sa signature de données.");
  } catch (error) {
    return actionError(error, "L’analyse n’a pas pu être enregistrée.");
  }
}

export type SavedAnalysisRun = {
  id: string;
  traitId: string;
  specification: AnalyticsFilters;
  datasetFingerprint: string;
  status: string;
  nObservations: number | null;
  createdAt: string;
  createdByName: string | null;
};

export async function listAnalysisRuns(
  programId: string,
): Promise<SavedAnalysisRun[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select(
      "id,trait_id,specification,dataset_fingerprint,status,n_observations,created_at,created_by,profiles(display_name)",
    )
    .eq("program_id", programId)
    .eq("analysis_type", "trait_intelligence")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    traitId: row.trait_id as string,
    specification: row.specification as AnalyticsFilters,
    datasetFingerprint: row.dataset_fingerprint as string,
    status: row.status as string,
    nObservations: row.n_observations as number | null,
    createdAt: row.created_at as string,
    createdByName:
      (row.profiles as { display_name: string | null } | null)?.display_name ??
      null,
  }));
}

/** Recomputes the current dataset fingerprint for a saved run's own
 * specification and compares it to what was stored (task §10): a mismatch
 * means the underlying observations have changed since the run was saved.
 * If the dataset has since grown too large to represent in full, the run
 * is conservatively reported stale rather than silently asserting it is
 * still fresh from an incomplete comparison. */
export async function isAnalysisRunStale(
  run: SavedAnalysisRun,
): Promise<boolean> {
  const { client } = await requireIdentity();
  const traits = await listNumericTraits(client, run.specification.programId);
  const trait = traits.find((t) => t.traitId === run.specification.traitId);
  if (!trait) return true;
  const dataset = await buildObservationDataset(
    client,
    run.specification,
    trait,
  );
  if (dataset.tooLarge) return true;
  const currentFingerprint = datasetFingerprint(
    toFingerprintRows(dataset.rows),
  );
  return currentFingerprint !== run.datasetFingerprint;
}
