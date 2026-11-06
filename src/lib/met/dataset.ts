import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listNumericTraits,
  type NumericTraitOption,
} from "@/lib/analytics/dataset";
import type { MetFilters, MetObservationRecord } from "./types";

/** The officially supported MET analysis size, mirroring
 * `MAX_OBSERVATION_ROWS` in `src/lib/analytics/dataset.ts` for the exact
 * same reason: `met_observation_dataset()` is always asked for
 * MAX_MET_OBSERVATION_ROWS + 1 rows (never exactly the cap), so getting
 * back more than the cap proves deterministically that the filtered
 * dataset is larger than what V2-05 supports - the caller must refuse to
 * run any statistical model on it (`dataset_too_large`) rather than
 * silently analyzing an arbitrary truncated subset of a multi-environment
 * trial, which would misrepresent the G×E structure itself. */
export const MAX_MET_OBSERVATION_ROWS = 5000;
const REQUEST_ROW_LIMIT = MAX_MET_OBSERVATION_ROWS + 1;

/** Every numeric/integer/ordinal trait active for the trial's program -
 * reuses V2-04's `listNumericTraits` rather than a parallel trait listing;
 * traits are a program-level concept, not a MET-specific one. */
export async function listTrialTraits(
  client: SupabaseClient,
  programId: string,
): Promise<NumericTraitOption[]> {
  return listNumericTraits(client, programId);
}

type RpcRow = {
  trait_value_id: string;
  numeric_value: number;
  evaluation_id: string;
  evaluation_date: string | null;
  phenotype_id: string;
  phenotype_code: string;
  entry_id: string;
  entry_code: string;
  entry_label: string;
  entry_scientific_role: MetObservationRecord["entryScientificRole"];
  environment_id: string;
  environment_code: string;
  site_id: string;
  site_code: string;
  campaign: string | null;
  block: string | null;
  replicate: number | null;
};

export type MetDatasetResult = {
  /** Up to MAX_MET_OBSERVATION_ROWS + 1 rows. When `tooLarge` is true this
   * is only a best-effort preview - it must never be fed into a
   * statistical model (R engine or otherwise): the true filtered dataset
   * is larger than what fits, and analyzing a prefix of it would silently
   * misrepresent the trial's actual entry×environment structure. Callers
   * that build a model input must check `tooLarge` first. */
  rows: MetObservationRecord[];
  tooLarge: boolean;
};

/** The ONE canonical fetch every V2-05 multi-environment analysis is built
 * from, mirroring `buildObservationDataset` in
 * `src/lib/analytics/dataset.ts`. Calls the RLS-scoped
 * `met_observation_dataset` SQL function (migration 000028) with every
 * filter passed through server-side; SECURITY INVOKER on that function
 * means the caller's own RLS on every joined table (trials, trial_entries,
 * environments, sites, phenotypes) still applies independently of the
 * function's own redundant `can_access_program` guard. */
export async function buildMetObservationDataset(
  client: SupabaseClient,
  filters: MetFilters,
): Promise<MetDatasetResult> {
  const { data, error } = await client.rpc("met_observation_dataset", {
    target_trial_id: filters.trialId,
    target_trait_id: filters.traitId,
    include_archived: filters.includeArchived,
    row_limit: REQUEST_ROW_LIMIT,
    target_evaluation_date: filters.evaluationDate,
  });
  if (error || !data) return { rows: [], tooLarge: false };
  const rpcRows = data as RpcRow[];
  const tooLarge = rpcRows.length > MAX_MET_OBSERVATION_ROWS;

  const rows: MetObservationRecord[] = rpcRows.map((row) => ({
    traitValueId: row.trait_value_id,
    numericValue: Number(row.numeric_value),
    evaluationId: row.evaluation_id,
    evaluationDate: row.evaluation_date,
    phenotypeId: row.phenotype_id,
    phenotypeCode: row.phenotype_code,
    entryId: row.entry_id,
    entryCode: row.entry_code,
    entryLabel: row.entry_label,
    entryScientificRole: row.entry_scientific_role,
    environmentId: row.environment_id,
    environmentCode: row.environment_code,
    siteId: row.site_id,
    siteCode: row.site_code,
    campaign: row.campaign,
    block: row.block,
    replicate: row.replicate,
  }));

  return { rows, tooLarge };
}

// summarizeMetDesign/detectMetLongitudinalAmbiguity live in
// ./design-summary.ts, without a "server-only" guard, so they stay
// directly unit-testable; re-exported here so callers of the dataset
// builder have them at the same import path.
export {
  summarizeMetDesign,
  type MetDesignSummary,
  detectMetLongitudinalAmbiguity,
  type MetOccasionDiagnostics,
} from "./design-summary";
