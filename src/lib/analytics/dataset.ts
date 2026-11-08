import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyticsFilters,
  CategoricalObservationRecord,
  ObservationRecord,
} from "./types";

/** The officially supported analysis size. The SQL functions this module
 * calls are always asked for MAX_OBSERVATION_ROWS + 1 rows (never exactly
 * MAX_OBSERVATION_ROWS): getting back more than MAX_OBSERVATION_ROWS proves
 * deterministically that the filtered dataset is larger than what V2-04
 * supports, so the caller can refuse to compute statistics on it
 * (DATASET_TOO_LARGE) instead of ever silently analyzing an arbitrary
 * truncated subset. */
export const MAX_OBSERVATION_ROWS = 5000;
const REQUEST_ROW_LIMIT = MAX_OBSERVATION_ROWS + 1;

export type NumericTraitOption = {
  traitId: string;
  code: string;
  name: string;
  unit: string | null;
  direction: string;
  targetValue: number | null;
  dataType: "numeric" | "integer" | "ordinal";
};

export type CategoricalTraitOption = {
  traitId: string;
  code: string;
  name: string;
  dataType: "categorical" | "boolean";
  allowedValues: string[] | null;
};

/** Every numeric/integer/ordinal trait currently active for the program
 * (task §6/§7); reuses the existing, already-audited `program_active_traits`
 * RPC (migration 000016) rather than inventing a parallel trait listing. */
export async function listNumericTraits(
  client: SupabaseClient,
  programId: string,
): Promise<NumericTraitOption[]> {
  const { data, error } = await client.rpc("program_active_traits", {
    target_program_id: programId,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .filter((row) =>
      ["numeric", "integer", "ordinal"].includes(row.data_type as string),
    )
    .map((row) => ({
      traitId: row.trait_id as string,
      code: row.code as string,
      name: row.name as string,
      unit: row.unit as string | null,
      direction: row.direction as string,
      targetValue: row.target_value as number | null,
      dataType: row.data_type as "numeric" | "integer" | "ordinal",
    }));
}

/** Every categorical/boolean trait active for the program (task §5 scope
 * completion: frequency-only summaries, never fed into a numeric model). */
export async function listCategoricalTraits(
  client: SupabaseClient,
  programId: string,
): Promise<CategoricalTraitOption[]> {
  const { data, error } = await client.rpc("program_active_traits", {
    target_program_id: programId,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .filter((row) =>
      ["categorical", "boolean"].includes(row.data_type as string),
    )
    .map((row) => ({
      traitId: row.trait_id as string,
      code: row.code as string,
      name: row.name as string,
      dataType: row.data_type as "categorical" | "boolean",
      allowedValues: row.allowed_values as string[] | null,
    }));
}

type RpcRow = {
  trait_value_id: string;
  numeric_value: number;
  evaluation_id: string;
  evaluation_date: string | null;
  evaluator_id: string | null;
  phenotype_id: string;
  phenotype_code: string;
  family_id: string | null;
  seed_lot_id: string | null;
  block: string | null;
  replicate: number | null;
  location: string | null;
};

export type DatasetResult = {
  /** Up to MAX_OBSERVATION_ROWS + 1 rows. When `tooLarge` is true, this is
   * only a best-effort preview (e.g. for discovering filter option values)
   * - it must never be fed into a statistical computation: the complete
   * filtered dataset is larger than what fits, and analyzing a prefix of
   * it would silently misrepresent the true cohort (task review finding
   * #1). Callers that compute statistics must check `tooLarge` first. */
  rows: ObservationRecord[];
  tooLarge: boolean;
};

/** The ONE canonical fetch every analysis is built from (task §7). Calls
 * the RLS-scoped `trait_observation_dataset` SQL function (migration
 * 000027) with EVERY filter (date range, family/seed-lot/block/replicate/
 * location, archived-inclusion) passed through server-side - never applied
 * client-side after the fact. An earlier revision fetched an unfiltered,
 * already-capped page and filtered in TypeScript, which could silently
 * return zero rows for a filter value that only occurs past row 5000 of a
 * larger unfiltered dataset; that bug is why every filter here reaches the
 * database. */
export async function buildObservationDataset(
  client: SupabaseClient,
  filters: AnalyticsFilters,
  trait: NumericTraitOption,
): Promise<DatasetResult> {
  const { data, error } = await client.rpc("trait_observation_dataset", {
    target_program_id: filters.programId,
    target_trait_id: filters.traitId,
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    filter_family_ids: filters.familyIds?.length ? filters.familyIds : null,
    filter_seed_lot_ids: filters.seedLotIds?.length ? filters.seedLotIds : null,
    filter_blocks: filters.blocks?.length ? filters.blocks : null,
    filter_replicates: filters.replicates?.length ? filters.replicates : null,
    filter_locations: filters.locations?.length ? filters.locations : null,
    include_archived: filters.includeArchived,
    row_limit: REQUEST_ROW_LIMIT,
  });
  if (error || !data) return { rows: [], tooLarge: false };
  const rpcRows = data as RpcRow[];
  const tooLarge = rpcRows.length > MAX_OBSERVATION_ROWS;

  const rows: ObservationRecord[] = rpcRows.map((row) => ({
    traitId: filters.traitId,
    traitCode: trait.code,
    traitName: trait.name,
    unit: trait.unit,
    direction: trait.direction,
    targetValue: trait.targetValue,
    phenotypeId: row.phenotype_id,
    phenotypeCode: row.phenotype_code,
    familyId: row.family_id,
    seedLotId: row.seed_lot_id,
    block: row.block,
    replicate: row.replicate,
    location: row.location,
    evaluationId: row.evaluation_id,
    evaluationDate: row.evaluation_date,
    evaluatorId: row.evaluator_id,
    traitValueId: row.trait_value_id,
    numericValue: Number(row.numeric_value),
  }));

  return { rows, tooLarge };
}

type CategoricalRpcRow = {
  trait_value_id: string;
  text_value: string | null;
  boolean_value: boolean | null;
  evaluation_id: string;
  evaluation_date: string | null;
  phenotype_id: string;
  phenotype_code: string;
};

export type CategoricalDatasetResult = {
  rows: CategoricalObservationRecord[];
  tooLarge: boolean;
};

/** Sibling of buildObservationDataset for categorical/boolean traits (task
 * §5). Same server-side-filters-before-cap discipline. */
export async function buildCategoricalDataset(
  client: SupabaseClient,
  filters: AnalyticsFilters,
  trait: CategoricalTraitOption,
): Promise<CategoricalDatasetResult> {
  const { data, error } = await client.rpc("trait_categorical_dataset", {
    target_program_id: filters.programId,
    target_trait_id: trait.traitId,
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    filter_family_ids: filters.familyIds?.length ? filters.familyIds : null,
    filter_seed_lot_ids: filters.seedLotIds?.length ? filters.seedLotIds : null,
    filter_blocks: filters.blocks?.length ? filters.blocks : null,
    filter_replicates: filters.replicates?.length ? filters.replicates : null,
    filter_locations: filters.locations?.length ? filters.locations : null,
    include_archived: filters.includeArchived,
    row_limit: REQUEST_ROW_LIMIT,
  });
  if (error || !data) return { rows: [], tooLarge: false };
  const rpcRows = data as CategoricalRpcRow[];
  const tooLarge = rpcRows.length > MAX_OBSERVATION_ROWS;
  const rows: CategoricalObservationRecord[] = rpcRows.map((row) => ({
    traitValueId: row.trait_value_id,
    textValue: row.text_value,
    booleanValue: row.boolean_value,
    evaluationId: row.evaluation_id,
    evaluationDate: row.evaluation_date,
    phenotypeId: row.phenotype_id,
    phenotypeCode: row.phenotype_code,
  }));
  return { rows, tooLarge };
}

type EvaluationRpcRow = {
  evaluation_id: string;
  phenotype_id: string;
  family_id: string | null;
  seed_lot_id: string | null;
  block: string | null;
  replicate: number | null;
  location: string | null;
};

export type CohortEvaluationCountResult = {
  count: number;
  tooLarge: boolean;
};

/** Every scoring event for the same cohort, trait-independent, with the
 * SAME filters applied server-side before the same cap - the denominator
 * `nEvaluationEvents` (never "n missing", see docs/ANALYTICS.md §4) needs
 * to be an honest, complete count, not a count derived from a truncated
 * page. */
export async function countCohortEvaluations(
  client: SupabaseClient,
  filters: AnalyticsFilters,
): Promise<CohortEvaluationCountResult> {
  const { data, error } = await client.rpc("program_evaluation_dataset", {
    target_program_id: filters.programId,
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    filter_family_ids: filters.familyIds?.length ? filters.familyIds : null,
    filter_seed_lot_ids: filters.seedLotIds?.length ? filters.seedLotIds : null,
    filter_blocks: filters.blocks?.length ? filters.blocks : null,
    filter_replicates: filters.replicates?.length ? filters.replicates : null,
    filter_locations: filters.locations?.length ? filters.locations : null,
    include_archived: filters.includeArchived,
    row_limit: REQUEST_ROW_LIMIT,
  });
  if (error || !data) return { count: 0, tooLarge: false };
  const rows = data as EvaluationRpcRow[];
  return { count: rows.length, tooLarge: rows.length > MAX_OBSERVATION_ROWS };
}

export type FilterOptions = {
  families: string[];
  seedLots: string[];
  blocks: string[];
  replicates: number[];
  locations: string[];
};

/** Distinct filter option values present in an already-fetched dataset -
 * never a second, unbounded query. This is explicitly NOT a statistical
 * use: even when the underlying fetch is `tooLarge` (so `rows` is only a
 * best-effort preview), deriving dropdown choices from that preview is an
 * acceptable UX degradation - unlike feeding those same rows into a
 * statistic, which callers must never do. */
export function deriveFilterOptions(rows: ObservationRecord[]): FilterOptions {
  const families = new Set<string>();
  const seedLots = new Set<string>();
  const blocks = new Set<string>();
  const replicates = new Set<number>();
  const locations = new Set<string>();
  for (const row of rows) {
    if (row.familyId) families.add(row.familyId);
    if (row.seedLotId) seedLots.add(row.seedLotId);
    if (row.block) blocks.add(row.block);
    if (row.replicate != null) replicates.add(row.replicate);
    if (row.location) locations.add(row.location);
  }
  return {
    families: [...families],
    seedLots: [...seedLots],
    blocks: [...blocks].sort(),
    replicates: [...replicates].sort((a, b) => a - b),
    locations: [...locations].sort(),
  };
}
