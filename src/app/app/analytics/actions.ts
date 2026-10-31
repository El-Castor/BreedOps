"use server";

import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";
import { requireIdentity } from "@/lib/auth";
import {
  buildObservationDataset,
  countCohortEvaluations,
  listNumericTraits,
  type NumericTraitOption,
} from "@/lib/analytics/dataset";
import { computeTraitIntelligence } from "@/lib/analytics/analysis";
import { computeTraitAssociations } from "@/lib/analytics/associations";
import { computeEarlyProxyEvidence } from "@/lib/analytics/proxy";
import { datasetFingerprint } from "@/lib/analytics/fingerprint";
import type {
  AnalyticsFilters,
  EarlyProxyEvidence,
  TraitIntelligenceBundle,
} from "@/lib/analytics/types";
import { filtersFromFormData } from "./filters";

export async function loadTraitIntelligence(
  filters: AnalyticsFilters,
): Promise<{
  bundle: TraitIntelligenceBundle;
  rowsForFingerprint: {
    evaluationId: string;
    traitValueId: string;
    traitId: string;
    phenotypeId: string;
    evaluationDate: string | null;
    numericValue: number;
  }[];
} | null> {
  const { client } = await requireIdentity();
  const traits = await listNumericTraits(client, filters.programId);
  const trait = traits.find((t) => t.traitId === filters.traitId);
  if (!trait) return null;

  const [dataset, nEvaluations] = await Promise.all([
    buildObservationDataset(client, filters, trait),
    countCohortEvaluations(client, filters),
  ]);
  const nMissing = Math.max(0, nEvaluations - dataset.rows.length);
  const bundle = computeTraitIntelligence(
    dataset.rows,
    trait,
    nMissing,
    dataset.truncated,
  );
  bundle.associations = await computeTraitAssociations(
    client,
    filters,
    dataset.rows,
    traits,
  );

  return {
    bundle,
    rowsForFingerprint: dataset.rows.map((r) => ({
      evaluationId: r.evaluationId,
      traitValueId: r.traitValueId,
      traitId: r.traitId,
      phenotypeId: r.phenotypeId,
      evaluationDate: r.evaluationDate,
      numericValue: r.numericValue,
    })),
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
  const { deriveFilterOptions } = await import("@/lib/analytics/dataset");
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

export async function loadEarlyProxyEvidence(
  filters: AnalyticsFilters,
  sourceTraitId: string,
  sourceFrom: string,
  sourceTo: string,
  targetTraitId: string,
  targetFrom: string,
  targetTo: string,
): Promise<EarlyProxyEvidence | null> {
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
    nTotalRows: bundle.nTotalRows,
    truncated: bundle.truncated,
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
    if (!loaded) {
      return actionError(
        new Error("trait not found"),
        "Trait introuvable pour ce programme.",
      );
    }
    const fingerprint = datasetFingerprint(loaded.rowsForFingerprint);
    const status: "completed" | "not_estimable" =
      loaded.bundle.nTotalRows > 0 ? "completed" : "not_estimable";
    const { error } = await client.from("analytics_runs").insert({
      program_id: filters.programId,
      trait_id: filters.traitId,
      analysis_type: "trait_intelligence",
      spec_version: "1",
      specification: filters,
      dataset_fingerprint: fingerprint,
      status,
      result: summarizeForStorage(loaded.bundle),
      n_observations: loaded.bundle.nTotalRows,
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
 * means the underlying observations have changed since the run was saved. */
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
  const currentFingerprint = datasetFingerprint(
    dataset.rows.map((r) => ({
      evaluationId: r.evaluationId,
      traitValueId: r.traitValueId,
      traitId: r.traitId,
      phenotypeId: r.phenotypeId,
      evaluationDate: r.evaluationDate,
      numericValue: r.numericValue,
    })),
  );
  return currentFingerprint !== run.datasetFingerprint;
}
