import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMetObservationDataset,
  detectMetLongitudinalAmbiguity,
} from "@/lib/met/dataset";
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

/** A trait value read from an already-stored V2-05 analytics_runs row -
 * never re-derives anything, never calls the R engine again. Validates
 * the stored run is the exact model type/status this source_type needs
 * before trusting its result shape. */
async function resolveFromMetRun(
  client: SupabaseClient,
  sourceRunId: string,
  trialId: string,
  modelType: "met_base_v1" | "met_waasb_v1",
  extract: (entry: Record<string, unknown>) => number | null,
): Promise<TraitResolutionResult> {
  const { data, error } = await client
    .from("analytics_runs")
    .select("id,trial_id,analysis_type,status,result")
    .eq("id", sourceRunId)
    .maybeSingle();
  if (error || !data) {
    return {
      status: "failed",
      reason:
        "La source analytics_runs indiquée est introuvable ou inaccessible.",
    };
  }
  const row = data as Record<string, unknown>;
  if (row.analysis_type !== "multi_environment" || row.trial_id !== trialId) {
    return {
      status: "failed",
      reason:
        "La source indiquée n'est pas une analyse multi-environnement de ce même essai.",
    };
  }
  if (row.status !== "completed") {
    return {
      status: "failed",
      reason: `La source indiquée n'a pas le statut "completed" (statut actuel : ${String(row.status)}).`,
    };
  }
  const result = row.result as Record<string, unknown> | null;
  if (!result || result.model_type !== modelType) {
    return {
      status: "failed",
      reason: `La source indiquée n'est pas un résultat de type ${modelType}.`,
    };
  }
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
      "met_base_v1",
      (entry) => (typeof entry.blup === "number" ? entry.blup : null),
    );
  }
  if (spec.sourceType === "WAASBY_STABILITY_PERFORMANCE") {
    return resolveFromMetRun(
      client,
      spec.sourceRunId,
      trialId,
      "met_waasb_v1",
      (entry) => (typeof entry.waasby === "number" ? entry.waasby : null),
    );
  }

  return {
    status: "failed",
    reason: `${spec.sourceType} n'est pas encore pris en charge par cette version de BreedOps.`,
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
