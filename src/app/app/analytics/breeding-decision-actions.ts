"use server";

import { createHash } from "node:crypto";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";
import {
  buildCandidateTraitMatrix,
  buildMtsiRawDataset,
} from "@/lib/breeding-decision/dataset";
import { evaluateSelectionMethodEligibility } from "@/lib/breeding-decision/eligibility";
import {
  runSelectionMgidiModel,
  runSelectionMtsiModel,
  type SelectionCandidateInput,
  type SelectionMatrixCellInput,
  type SelectionTraitInput,
} from "@/lib/breeding-decision/r-runner";
import { computeSelectionDifferentials } from "@/lib/breeding-decision/selection-differential";
import {
  compareMethodRankings,
  type MethodComparison,
  type MethodRanking,
} from "@/lib/breeding-decision/method-comparison";
import {
  buildGeneticValidityPanel,
  computeBroadSenseHeritability,
} from "@/lib/breeding-decision/genetic-validity";
import type {
  BreedingCandidateTraitMatrix,
  BreedingScenarioTraitSpec,
} from "@/lib/breeding-decision/types";
import {
  breedingRunInputFromFormData,
  breedingScenarioInputFromFormData,
  breedingScenarioTraitInputFromFormData,
} from "./breeding-decision-filters";

/** Deterministic sha256 digest over the exact candidate x trait values a
 * run was built from - the same staleness-detection role
 * src/lib/analytics/fingerprint.ts's datasetFingerprint() plays for
 * V2-04/V2-05, adapted here because a breeding-decision matrix cell can
 * come from several different source types (raw observations, a stored
 * MET run's own BLUP/WAASBY) that don't share one common row-level
 * provenance shape to hash directly. */
function computeMatrixFingerprint(
  matrix: BreedingCandidateTraitMatrix,
): string {
  const sorted = [...matrix.cells].sort((a, b) =>
    a.candidateId === b.candidateId
      ? a.traitId.localeCompare(b.traitId)
      : a.candidateId.localeCompare(b.candidateId),
  );
  const hash = createHash("sha256");
  for (const cell of sorted) {
    hash.update(`${cell.candidateId}|${cell.traitId}|${cell.value ?? ""}\n`);
  }
  return hash.digest("hex");
}

function computeRowsFingerprint(
  rows: {
    entry_id: string;
    environment_id: string;
    block: string | null;
    trait_id: string;
    value: number;
  }[],
): string {
  const sorted = [...rows].sort((a, b) => {
    const key = (r: typeof a) =>
      `${r.entry_id}|${r.environment_id}|${r.block ?? ""}|${r.trait_id}`;
    return key(a).localeCompare(key(b));
  });
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(
      `${row.entry_id}|${row.environment_id}|${row.block ?? ""}|${row.trait_id}|${row.value}\n`,
    );
  }
  return hash.digest("hex");
}

export async function createBreedingDecisionScenario(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const input = breedingScenarioInputFromFormData(form);
    const { client } = await requireIdentity();
    const { error } = await client.from("breeding_decision_scenarios").insert({
      program_id: input.programId,
      trial_id: input.trialId,
      name: input.name,
      description: input.description,
      candidate_eligibility: input.candidateEligibility,
      selection_proportion: input.selectionProportion,
    });
    if (error) throw error;
    return actionSuccess("Scénario de décision créé.");
  } catch (error) {
    return actionError(error, "Impossible de créer ce scénario.");
  }
}

export async function archiveBreedingDecisionScenario(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const scenarioId = String(form.get("scenario_id"));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("breeding_decision_scenarios")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", scenarioId);
    if (error) throw error;
    return actionSuccess("Scénario archivé.");
  } catch (error) {
    return actionError(error, "Impossible d’archiver ce scénario.");
  }
}

export async function addBreedingDecisionScenarioTrait(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const input = breedingScenarioTraitInputFromFormData(form);
    const { client } = await requireIdentity();
    const { error } = await client
      .from("breeding_decision_scenario_traits")
      .insert({
        scenario_id: input.scenarioId,
        trait_id: input.traitId,
        direction: input.direction,
        target_value: input.targetValue,
        weight: input.weight,
        economic_weight: input.economicWeight,
        source_type: input.sourceType,
        source_run_id: input.sourceRunId,
        evaluation_date: input.evaluationDate,
      });
    if (error) throw error;
    return actionSuccess("Trait ajouté au scénario.");
  } catch (error) {
    return actionError(error, "Impossible d’ajouter ce trait au scénario.");
  }
}

export async function removeBreedingDecisionScenarioTrait(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const scenarioTraitId = String(form.get("scenario_trait_id"));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("breeding_decision_scenario_traits")
      .delete()
      .eq("id", scenarioTraitId);
    if (error) throw error;
    return actionSuccess("Trait retiré du scénario.");
  } catch (error) {
    return actionError(error, "Impossible de retirer ce trait du scénario.");
  }
}

export type SavedBreedingDecisionScenario = {
  id: string;
  programId: string;
  trialId: string;
  name: string;
  description: string | null;
  candidateEligibility: "all" | "exclude_operationally_eliminated";
  selectionProportion: number;
  createdAt: string;
};

export async function listBreedingDecisionScenarios(
  programId: string,
  trialId: string,
): Promise<SavedBreedingDecisionScenario[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("breeding_decision_scenarios")
    .select(
      "id,program_id,trial_id,name,description,candidate_eligibility,selection_proportion,created_at",
    )
    .eq("program_id", programId)
    .eq("trial_id", trialId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    programId: row.program_id as string,
    trialId: row.trial_id as string,
    name: row.name as string,
    description: row.description as string | null,
    candidateEligibility: row.candidate_eligibility as
      | "all"
      | "exclude_operationally_eliminated",
    selectionProportion: row.selection_proportion as number,
    createdAt: row.created_at as string,
  }));
}

export type SavedBreedingDecisionScenarioTrait = {
  id: string;
  traitId: string;
  traitCode: string;
  traitName: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better" | "target_value";
  targetValue: number | null;
  weight: number | null;
  economicWeight: number | null;
  sourceType: BreedingScenarioTraitSpec["sourceType"];
  sourceRunId: string | null;
  evaluationDate: string | null;
};

export async function listBreedingDecisionScenarioTraits(
  scenarioId: string,
): Promise<SavedBreedingDecisionScenarioTrait[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("breeding_decision_scenario_traits")
    .select(
      "id,trait_id,direction,target_value,weight,economic_weight,source_type,source_run_id,evaluation_date,phenotype_traits(code,name,unit)",
    )
    .eq("scenario_id", scenarioId)
    .order("display_order");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => {
    const trait = row.phenotype_traits as {
      code: string;
      name: string;
      unit: string | null;
    } | null;
    return {
      id: row.id as string,
      traitId: row.trait_id as string,
      traitCode: trait?.code ?? (row.trait_id as string),
      traitName: trait?.name ?? (row.trait_id as string),
      unit: trait?.unit ?? null,
      direction:
        row.direction as SavedBreedingDecisionScenarioTrait["direction"],
      targetValue: row.target_value as number | null,
      weight: row.weight as number | null,
      economicWeight: row.economic_weight as number | null,
      sourceType: row.source_type as BreedingScenarioTraitSpec["sourceType"],
      sourceRunId: row.source_run_id as string | null,
      evaluationDate: row.evaluation_date as string | null,
    };
  });
}

/** Lists this trial's own completed V2-05 analytics_runs of one model
 * type - the candidate "source analysis" dropdown for a scenario trait
 * whose source_type needs one (MET_ENTRY_PREDICTION/
 * WAASBY_STABILITY_PERFORMANCE). Never lets a client just type a run id
 * freehand - only a run this trial actually produced can be offered. */
export async function listCompletedMetRunsForTrial(
  trialId: string,
  modelType: "met_base_v1" | "met_waasb_v1",
): Promise<{ id: string; traitId: string; createdAt: string }[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select("id,trait_id,created_at,result")
    .eq("trial_id", trialId)
    .eq("analysis_type", "multi_environment")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .filter((row) => {
      const result = row.result as Record<string, unknown> | null;
      return result?.model_type === modelType;
    })
    .map((row) => ({
      id: row.id as string,
      traitId: row.trait_id as string,
      createdAt: row.created_at as string,
    }));
}

async function loadScenarioTraitSpecs(
  scenarioId: string,
): Promise<BreedingScenarioTraitSpec[]> {
  const saved = await listBreedingDecisionScenarioTraits(scenarioId);
  return saved.map((t) => ({
    traitId: t.traitId,
    traitCode: t.traitCode,
    traitName: t.traitName,
    unit: t.unit,
    direction: t.direction,
    targetValue: t.targetValue,
    weight: t.weight,
    economicWeight: t.economicWeight,
    sourceType: t.sourceType,
    sourceRunId: t.sourceRunId,
    evaluationDate: t.evaluationDate,
  }));
}

/** Form-action entry point: fetches the scenario, builds the canonical
 * candidate x trait evidence (never a parallel path per method), runs
 * the eligibility gate BEFORE ever invoking the R engine, and persists
 * the outcome into the existing analytics_runs table with
 * analysis_type='breeding_decision' - never a parallel provenance
 * system (task review §7). A NOT_ESTIMABLE verdict is saved exactly
 * like a successful run: a correct, reproducible result, never hidden. */
export async function createBreedingDecisionRun(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const input = breedingRunInputFromFormData(form);
    const { client, profile } = await requireIdentity();

    const { data: scenarioRow, error: scenarioError } = await client
      .from("breeding_decision_scenarios")
      .select(
        "id,program_id,trial_id,candidate_eligibility,selection_proportion",
      )
      .eq("id", input.scenarioId)
      .maybeSingle();
    if (scenarioError || !scenarioRow) {
      return actionError(
        new Error("scenario not found"),
        "Scénario introuvable.",
      );
    }
    if (scenarioRow.program_id !== input.programId) {
      throw new Error("Scenario does not belong to this program.");
    }
    const trialId = scenarioRow.trial_id as string;
    const candidateEligibility = scenarioRow.candidate_eligibility as
      | "all"
      | "exclude_operationally_eliminated";
    const selectionProportion = scenarioRow.selection_proportion as number;

    const traits = await loadScenarioTraitSpecs(input.scenarioId);
    if (traits.length === 0) {
      return actionError(
        new Error("no traits"),
        "Ajoutez au moins un trait au scénario avant de lancer une analyse.",
      );
    }

    const startedAt = new Date().toISOString();
    const specification = {
      scenarioId: input.scenarioId,
      method: input.method,
      selectionProportion,
      candidateEligibility,
      traits: traits.map((t) => ({
        traitId: t.traitId,
        direction: t.direction,
        targetValue: t.targetValue,
        weight: t.weight,
        economicWeight: t.economicWeight,
        sourceType: t.sourceType,
        sourceRunId: t.sourceRunId,
        evaluationDate: t.evaluationDate,
      })),
    };

    const saveNotEstimable = async (
      reason: string,
      fingerprint: string,
      nObservations: number,
    ) => {
      const { error } = await client.from("analytics_runs").insert({
        program_id: input.programId,
        trial_id: trialId,
        analysis_type: "breeding_decision",
        scenario_id: input.scenarioId,
        spec_version: "1",
        specification,
        dataset_fingerprint: fingerprint,
        status: "not_estimable",
        result: {
          method: input.method,
          eligibility: { eligible: false, reasons: [reason] },
        },
        n_observations: nObservations,
        engine_name: "breedops-breeding-decision-eligibility",
        engine_version: "1.0.0",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        created_by: profile.id,
      });
      if (error) throw error;
      return actionSuccess(
        "Analyse enregistrée : NOT_ESTIMABLE. Les raisons détaillées sont disponibles dans l’historique.",
      );
    };

    if (input.method === "selection_mgidi_v1") {
      const matrixResult = await buildCandidateTraitMatrix(client, {
        trialId,
        candidateEligibility,
        traits,
      });
      if (matrixResult.status === "failed") {
        return saveNotEstimable(
          matrixResult.reason,
          computeMatrixFingerprint({
            candidates: [],
            traits,
            cells: [],
            evidenceLevel: "PHENOTYPIC",
            coverage: {
              candidateCount: 0,
              traitCount: traits.length,
              completeCandidateCount: 0,
              missingCells: 0,
              coverage: 0,
            },
          }),
          0,
        );
      }
      const matrix = matrixResult.matrix;
      const fingerprint = computeMatrixFingerprint(matrix);
      const eligibility = evaluateSelectionMethodEligibility(
        "selection_mgidi_v1",
        matrix,
      );
      if (!eligibility.eligible) {
        return saveNotEstimable(
          eligibility.reasons.join(" "),
          fingerprint,
          matrix.cells.length,
        );
      }

      const completeSet = new Set(eligibility.completeCaseCandidateIds);
      const candidatesInput: SelectionCandidateInput[] = matrix.candidates
        .filter((c) => completeSet.has(c.candidateId))
        .map((c) => ({ candidate_id: c.candidateId }));
      const traitsInput: SelectionTraitInput[] = traits.map((t) => ({
        trait_id: t.traitId,
        direction: t.direction,
        target_value: t.targetValue,
        weight: t.weight,
        economic_weight: t.economicWeight,
      }));
      const matrixInput: SelectionMatrixCellInput[] = matrix.cells
        .filter((c) => completeSet.has(c.candidateId) && c.value !== null)
        .map((c) => ({
          candidate_id: c.candidateId,
          trait_id: c.traitId,
          value: c.value as number,
        }));

      const rResult = await runSelectionMgidiModel(
        candidatesInput,
        traitsInput,
        matrixInput,
        selectionProportion,
      );
      if (rResult.status !== "ok") {
        return saveNotEstimable(
          rResult.message,
          fingerprint,
          matrix.cells.length,
        );
      }

      const selectedIds = rResult.data.candidates
        .filter((c) => c.selected)
        .map((c) => c.candidate_id);
      const selectionDifferentials = computeSelectionDifferentials(
        matrix,
        selectedIds,
      );
      const allGenotype = matrix.candidates.every(
        (c) => c.candidateScientificRole === "genotype",
      );
      const genericPanel = buildGeneticValidityPanel({
        candidateRankingAvailable: true,
        multiEnvironmentStabilityAvailable: traits.some(
          (t) => t.sourceType === "WAASBY_STABILITY_PERFORMANCE",
        ),
        heritability: allGenotype
          ? null
          : {
              status: "NOT_ESTIMABLE",
              reason:
                "Tous les candidats ne sont pas déclarés scientific_role='genotype'.",
            },
      });

      const { error } = await client.from("analytics_runs").insert({
        program_id: input.programId,
        trial_id: trialId,
        analysis_type: "breeding_decision",
        scenario_id: input.scenarioId,
        spec_version: "1",
        specification,
        dataset_fingerprint: fingerprint,
        status: "completed",
        result: {
          method: input.method,
          engine: rResult.data.engine,
          model: rResult.data.model,
          candidates: rResult.data.candidates.slice(0, 2000),
          factor_loadings: rResult.data.factor_loadings,
          factor_contributions: rResult.data.factor_contributions.slice(
            0,
            2000,
          ),
          pca: rResult.data.pca,
          selection_differentials: selectionDifferentials,
          coverage: matrix.coverage,
          evidence_level: matrix.evidenceLevel,
          genetic_validity_panel: genericPanel,
        },
        n_observations: matrix.cells.length,
        engine_name: rResult.data.engine.engine_name,
        engine_version: rResult.data.engine.engine_version,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        created_by: profile.id,
      });
      if (error) throw error;
      return actionSuccess(
        "Analyse de décision d’amélioration (MGIDI) enregistrée.",
      );
    }

    // selection_mtsi_v1
    const rawResult = await buildMtsiRawDataset(client, trialId, traits);
    if (rawResult.status === "failed") {
      return saveNotEstimable(rawResult.reason, computeRowsFingerprint([]), 0);
    }
    const fingerprint = computeRowsFingerprint(rawResult.rows);
    const traitEligibility = evaluateSelectionMethodEligibility(
      "selection_mtsi_v1",
      {
        candidates: [],
        traits,
        cells: [],
        evidenceLevel: "ADJUSTED_ENTRY",
        coverage: {
          candidateCount: 0,
          traitCount: traits.length,
          completeCandidateCount: 0,
          missingCells: 0,
          coverage: 0,
        },
      },
    );
    if (!traitEligibility.eligible) {
      return saveNotEstimable(
        traitEligibility.reasons.join(" "),
        fingerprint,
        rawResult.rows.length,
      );
    }

    const traitsInput: SelectionTraitInput[] = traits.map((t) => ({
      trait_id: t.traitId,
      direction: t.direction,
      target_value: t.targetValue,
      weight: t.weight,
      economic_weight: t.economicWeight,
    }));
    const rResult = await runSelectionMtsiModel(
      traitsInput,
      rawResult.rows,
      selectionProportion,
      rawResult.performanceWeight,
    );
    if (rResult.status !== "ok") {
      return saveNotEstimable(
        rResult.message,
        fingerprint,
        rawResult.rows.length,
      );
    }

    const genericPanel = buildGeneticValidityPanel({
      candidateRankingAvailable: true,
      multiEnvironmentStabilityAvailable: true,
      heritability: null,
    });

    const { error } = await client.from("analytics_runs").insert({
      program_id: input.programId,
      trial_id: trialId,
      analysis_type: "breeding_decision",
      scenario_id: input.scenarioId,
      spec_version: "1",
      specification,
      dataset_fingerprint: fingerprint,
      status: "completed",
      result: {
        method: input.method,
        engine: rResult.data.engine,
        model: rResult.data.model,
        candidates: rResult.data.candidates.slice(0, 2000),
        factor_loadings: rResult.data.factor_loadings,
        factor_contributions: rResult.data.factor_contributions.slice(0, 2000),
        coverage: {
          candidateCount: rResult.data.candidates.length,
          traitCount: traits.length,
          completeCandidateCount: rResult.data.candidates.length,
          missingCells: 0,
          coverage: 1,
        },
        evidence_level: "ADJUSTED_ENTRY",
        genetic_validity_panel: genericPanel,
      },
      n_observations: rawResult.rows.length,
      engine_name: rResult.data.engine.engine_name,
      engine_version: rResult.data.engine.engine_version,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      created_by: profile.id,
    });
    if (error) throw error;
    return actionSuccess(
      "Analyse de décision d’amélioration (MTSI) enregistrée.",
    );
  } catch (error) {
    return actionError(
      error,
      "L’analyse de décision d’amélioration n’a pas pu être enregistrée.",
    );
  }
}

export type SavedBreedingDecisionRun = {
  id: string;
  trialId: string;
  scenarioId: string;
  specification: Record<string, unknown>;
  datasetFingerprint: string;
  status: string;
  nObservations: number | null;
  createdAt: string;
  createdByName: string | null;
};

export async function listBreedingDecisionRuns(
  programId: string,
  trialId: string,
): Promise<SavedBreedingDecisionRun[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select(
      "id,trial_id,scenario_id,specification,dataset_fingerprint,status,n_observations,created_at,created_by,profiles(display_name)",
    )
    .eq("program_id", programId)
    .eq("trial_id", trialId)
    .eq("analysis_type", "breeding_decision")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    trialId: row.trial_id as string,
    scenarioId: row.scenario_id as string,
    specification: row.specification as Record<string, unknown>,
    datasetFingerprint: row.dataset_fingerprint as string,
    status: row.status as string,
    nObservations: row.n_observations as number | null,
    createdAt: row.created_at as string,
    createdByName:
      (row.profiles as { display_name: string | null } | null)?.display_name ??
      null,
  }));
}

export type BreedingDecisionRunWithResult = SavedBreedingDecisionRun & {
  result: Record<string, unknown> | null;
};

export async function getLatestBreedingDecisionRun(
  programId: string,
  trialId: string,
): Promise<BreedingDecisionRunWithResult | null> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select(
      "id,trial_id,scenario_id,specification,dataset_fingerprint,status,n_observations,created_at,created_by,result,profiles(display_name)",
    )
    .eq("program_id", programId)
    .eq("trial_id", trialId)
    .eq("analysis_type", "breeding_decision")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    trialId: row.trial_id as string,
    scenarioId: row.scenario_id as string,
    specification: row.specification as Record<string, unknown>,
    datasetFingerprint: row.dataset_fingerprint as string,
    status: row.status as string,
    nObservations: row.n_observations as number | null,
    createdAt: row.created_at as string,
    createdByName:
      (row.profiles as { display_name: string | null } | null)?.display_name ??
      null,
    result: row.result as Record<string, unknown> | null,
  };
}

export type BreedingDecisionRunComparison = MethodComparison & {
  runALabel: string;
  runBLabel: string;
};

function methodRankingFromRun(
  run: Pick<BreedingDecisionRunWithResult, "status" | "result">,
): MethodRanking | null {
  if (run.status !== "completed" || !run.result) return null;
  const candidates = run.result.candidates;
  if (!Array.isArray(candidates)) return null;
  const method = String(run.result.method ?? "");
  const rankByCandidateId = new Map<string, number>();
  const selectedCandidateIds = new Set<string>();
  for (const candidate of candidates as Record<string, unknown>[]) {
    const candidateId = String(candidate.candidate_id);
    const rank = Number(candidate.rank);
    if (candidateId && Number.isFinite(rank)) {
      rankByCandidateId.set(candidateId, rank);
    }
    if (candidate.selected) selectedCandidateIds.add(candidateId);
  }
  return { methodName: method, rankByCandidateId, selectedCandidateIds };
}

/** Compares two already-saved breeding_decision runs for the same trial -
 * rank correlation, selected-set overlap, coincidence (task review §29).
 * This is how V2-06 satisfies "decision stability/sensitivity across
 * selection proportions/trait weights" (task review §30): the breeder
 * compares two runs they already made with different scenario settings,
 * rather than BreedOps running an automated parameter sweep. Returns null
 * for a run that is not "completed" (e.g. NOT_ESTIMABLE) - there is no
 * ranking to compare in that case, never a fabricated one. */
export async function compareBreedingDecisionRuns(
  programId: string,
  trialId: string,
  runIdA: string,
  runIdB: string,
): Promise<BreedingDecisionRunComparison | null> {
  if (runIdA === runIdB) return null;
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("analytics_runs")
    .select("id,status,result,created_at")
    .in("id", [runIdA, runIdB])
    .eq("program_id", programId)
    .eq("trial_id", trialId)
    .eq("analysis_type", "breeding_decision");
  if (error || !data || data.length !== 2) return null;
  const rowA = data.find((r) => r.id === runIdA) as Record<
    string,
    unknown
  > | null;
  const rowB = data.find((r) => r.id === runIdB) as Record<
    string,
    unknown
  > | null;
  if (!rowA || !rowB) return null;

  const rankingA = methodRankingFromRun({
    status: rowA.status as string,
    result: rowA.result as Record<string, unknown> | null,
  });
  const rankingB = methodRankingFromRun({
    status: rowB.status as string,
    result: rowB.result as Record<string, unknown> | null,
  });
  if (!rankingA || !rankingB) return null;

  const comparison = compareMethodRankings(rankingA, rankingB);
  const label = (ranking: MethodRanking, row: Record<string, unknown>) =>
    `${ranking.methodName} · ${new Date(row.created_at as string).toLocaleString("fr-FR")}`;
  return {
    ...comparison,
    runALabel: label(rankingA, rowA),
    runBLabel: label(rankingB, rowB),
  };
}
