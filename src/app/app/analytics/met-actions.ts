"use server";

import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";
import { requireIdentity } from "@/lib/auth";
import { buildMetObservationDataset } from "@/lib/met/dataset";
import { evaluateMetEligibility } from "@/lib/met/eligibility";
import {
  runMetAmmiModel,
  runMetBaseModel,
  runMetFinlayWilkinsonModel,
  runMetGgeModel,
  runMetWaasbModel,
  type MetModelRow,
} from "@/lib/met/r-runner";
import { datasetFingerprint } from "@/lib/analytics/fingerprint";
import type { MetObservationRecord } from "@/lib/met/types";
import { metRunInputFromFormData, type MetRunInput } from "./met-filters";

function toMetModelRows(rows: MetObservationRecord[]): MetModelRow[] {
  return rows.map((row) => ({
    entry_id: row.entryId,
    environment_id: row.environmentId,
    block: row.block,
    value: row.numericValue,
  }));
}

function toFingerprintRows(rows: MetObservationRecord[], traitId: string) {
  return rows.map((row) => ({
    evaluationId: row.evaluationId,
    traitValueId: row.traitValueId,
    traitId,
    phenotypeId: row.phenotypeId,
    evaluationDate: row.evaluationDate,
    numericValue: row.numericValue,
  }));
}

/** Caps what ever gets persisted into analytics_runs.result: a compact
 * summary, never the full per-row model output - mirrors
 * summarizeForStorage() in ./actions.ts. Migration 000027's own size CHECK
 * (<=200000 bytes) is the hard backstop; this stays well under it by
 * bounding every array, same as the V2-04 convention. */
function summarizeMetResultForStorage(
  modelType: MetRunInput["modelType"],
  result:
    | Awaited<ReturnType<typeof runMetBaseModel>>
    | Awaited<ReturnType<typeof runMetAmmiModel>>
    | Awaited<ReturnType<typeof runMetWaasbModel>>
    | Awaited<ReturnType<typeof runMetFinlayWilkinsonModel>>
    | Awaited<ReturnType<typeof runMetGgeModel>>,
): Record<string, unknown> {
  if (result.status !== "ok") {
    return {
      model_type: modelType,
      status: result.status,
      message: result.message,
    };
  }
  if (modelType === "met_base_v1" && "variance_components" in result.data) {
    return {
      model_type: modelType,
      engine: result.data.engine,
      model: result.data.model,
      variance_components: result.data.variance_components,
      fixed_effects_environment: result.data.fixed_effects_environment.slice(
        0,
        200,
      ),
      entry_predictions: result.data.entry_predictions.slice(0, 500),
      entry_environment_predictions:
        result.data.entry_environment_predictions.slice(0, 1000),
    };
  }
  if (modelType === "met_ammi_v1" && "principal_components" in result.data) {
    return {
      model_type: modelType,
      engine: result.data.engine,
      model: result.data.model,
      principal_components: result.data.principal_components.slice(0, 50),
      genotype_scores: result.data.genotype_scores.slice(0, 500),
      environment_scores: result.data.environment_scores.slice(0, 200),
    };
  }
  if (modelType === "met_gge_v1" && "grand_mean" in result.data) {
    return {
      model_type: modelType,
      engine: result.data.engine,
      model: result.data.model,
      grand_mean: result.data.grand_mean,
      principal_components: result.data.principal_components.slice(0, 50),
      genotype_scores: result.data.genotype_scores.slice(0, 500),
      environment_scores: result.data.environment_scores.slice(0, 200),
    };
  }
  if (
    (modelType === "met_waasb_v1" || modelType === "met_finlay_wilkinson_v1") &&
    "entries" in result.data
  ) {
    return {
      model_type: modelType,
      engine: result.data.engine,
      model: result.data.model,
      entries: result.data.entries.slice(0, 500),
    };
  }
  return {
    model_type: modelType,
    status: "error",
    message: "Unrecognized model result shape.",
  };
}

/** Form-action entry point (B17-B18): fetches the canonical MET dataset
 * for one trial/trait, runs the eligibility gate BEFORE ever invoking the
 * R engine, and persists the outcome into the existing analytics_runs
 * table with analysis_type='multi_environment' - never a parallel
 * provenance system. A NOT_ESTIMABLE verdict is saved exactly like a
 * successful run (same table, same fingerprint, status='not_estimable'):
 * it is a correct, reproducible result, not a failure to hide. */
export async function createMetAnalysisRun(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const input = metRunInputFromFormData(form);
    const { client, profile } = await requireIdentity();

    const dataset = await buildMetObservationDataset(client, {
      trialId: input.trialId,
      traitId: input.traitId,
      includeArchived: false,
    });
    if (dataset.tooLarge) {
      return actionError(
        new Error("met dataset too large"),
        "Le jeu de données de cet essai dépasse la taille d’analyse prise en charge.",
      );
    }

    const fingerprint = datasetFingerprint(
      toFingerprintRows(dataset.rows, input.traitId),
    );
    const startedAt = new Date().toISOString();
    const specification = {
      trialId: input.trialId,
      traitId: input.traitId,
      modelType: input.modelType,
      performanceWeight: input.performanceWeight,
    };

    const eligibility = evaluateMetEligibility(dataset.rows);
    if (!eligibility.eligible) {
      const { error } = await client.from("analytics_runs").insert({
        program_id: input.programId,
        trait_id: input.traitId,
        trial_id: input.trialId,
        analysis_type: "multi_environment",
        spec_version: "1",
        specification,
        dataset_fingerprint: fingerprint,
        status: "not_estimable",
        result: { model_type: input.modelType, eligibility },
        n_observations: dataset.rows.length,
        engine_name: "breedops-met-eligibility",
        engine_version: "1.0.0",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        created_by: profile.id,
      });
      if (error) throw error;
      return actionSuccess(
        "Analyse enregistrée : NOT_ESTIMABLE. Les raisons détaillées sont disponibles dans l’historique.",
      );
    }

    const modelRows = toMetModelRows(dataset.rows);
    const modelResult =
      input.modelType === "met_base_v1"
        ? await runMetBaseModel(modelRows)
        : input.modelType === "met_ammi_v1"
          ? await runMetAmmiModel(modelRows)
          : input.modelType === "met_finlay_wilkinson_v1"
            ? await runMetFinlayWilkinsonModel(modelRows)
            : input.modelType === "met_gge_v1"
              ? await runMetGgeModel(modelRows)
              : await runMetWaasbModel(
                  modelRows,
                  input.performanceWeight ?? 0.5,
                );

    const status: "completed" | "not_estimable" | "error" =
      modelResult.status === "ok"
        ? "completed"
        : modelResult.status === "not_estimable"
          ? "not_estimable"
          : "error";
    const engineName =
      modelResult.status === "ok"
        ? modelResult.data.engine.engine_name
        : "breedops-r-mixed-models";
    const engineVersion =
      modelResult.status === "ok"
        ? modelResult.data.engine.engine_version
        : "1.0.0";

    const { error } = await client.from("analytics_runs").insert({
      program_id: input.programId,
      trait_id: input.traitId,
      trial_id: input.trialId,
      analysis_type: "multi_environment",
      spec_version: "1",
      specification,
      dataset_fingerprint: fingerprint,
      status,
      result: summarizeMetResultForStorage(input.modelType, modelResult),
      n_observations: dataset.rows.length,
      engine_name: engineName,
      engine_version: engineVersion,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      created_by: profile.id,
    });
    if (error) throw error;

    if (status === "completed") {
      return actionSuccess("Analyse multi-environnement enregistrée.");
    }
    if (status === "not_estimable") {
      return actionSuccess(
        "Analyse enregistrée : NOT_ESTIMABLE. Le moteur statistique n’a pas pu estimer ce modèle pour ce jeu de données.",
      );
    }
    return actionError(
      new Error("met engine error"),
      "Le moteur statistique a rencontré une erreur. L’analyse a été enregistrée avec son statut d’échec.",
    );
  } catch (error) {
    return actionError(
      error,
      "L’analyse multi-environnement n’a pas pu être enregistrée.",
    );
  }
}

export type SavedMetAnalysisRun = {
  id: string;
  trialId: string;
  traitId: string;
  specification: MetRunInput;
  datasetFingerprint: string;
  status: string;
  nObservations: number | null;
  createdAt: string;
  createdByName: string | null;
};

/** Sibling of listAnalysisRuns in ./actions.ts, scoped to one trial. */
export async function listMetAnalysisRuns(
  programId: string,
  trialId: string,
): Promise<SavedMetAnalysisRun[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select(
      "id,trial_id,trait_id,specification,dataset_fingerprint,status,n_observations,created_at,created_by,profiles(display_name)",
    )
    .eq("program_id", programId)
    .eq("trial_id", trialId)
    .eq("analysis_type", "multi_environment")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    trialId: row.trial_id as string,
    traitId: row.trait_id as string,
    specification: row.specification as MetRunInput,
    datasetFingerprint: row.dataset_fingerprint as string,
    status: row.status as string,
    nObservations: row.n_observations as number | null,
    createdAt: row.created_at as string,
    createdByName:
      (row.profiles as { display_name: string | null } | null)?.display_name ??
      null,
  }));
}
