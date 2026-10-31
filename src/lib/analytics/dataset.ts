import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsFilters, ObservationRecord } from "./types";

export const MAX_OBSERVATION_ROWS = 5000;

export type NumericTraitOption = {
  traitId: string;
  code: string;
  name: string;
  unit: string | null;
  direction: string;
  targetValue: number | null;
  dataType: "numeric" | "integer" | "ordinal";
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
  rows: ObservationRecord[];
  truncated: boolean;
};

/** The ONE canonical fetch every analysis is built from (task §7). Calls
 * the RLS-scoped `trait_observation_dataset` SQL function (migration
 * 000027) with only the date-range/archived-inclusion filters that are
 * cheap to push server-side; family/seed-lot/block/replicate/location
 * filters are applied in-memory below on the already row-capped result -
 * the cap (task §40) bounds that cost regardless. */
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
    filter_family_ids: null,
    filter_seed_lot_ids: null,
    filter_blocks: null,
    filter_replicates: null,
    filter_locations: null,
    include_archived: filters.includeArchived,
    row_limit: MAX_OBSERVATION_ROWS,
  });
  if (error || !data) return { rows: [], truncated: false };
  const rpcRows = data as RpcRow[];
  const truncated = rpcRows.length >= MAX_OBSERVATION_ROWS;

  const familySet = filters.familyIds?.length
    ? new Set(filters.familyIds)
    : null;
  const seedLotSet = filters.seedLotIds?.length
    ? new Set(filters.seedLotIds)
    : null;
  const blockSet = filters.blocks?.length ? new Set(filters.blocks) : null;
  const replicateSet = filters.replicates?.length
    ? new Set(filters.replicates)
    : null;
  const locationSet = filters.locations?.length
    ? new Set(filters.locations)
    : null;

  const rows: ObservationRecord[] = rpcRows
    .filter(
      (row) => !familySet || (row.family_id && familySet.has(row.family_id)),
    )
    .filter(
      (row) =>
        !seedLotSet || (row.seed_lot_id && seedLotSet.has(row.seed_lot_id)),
    )
    .filter((row) => !blockSet || (row.block && blockSet.has(row.block)))
    .filter(
      (row) =>
        !replicateSet ||
        (row.replicate != null && replicateSet.has(row.replicate)),
    )
    .filter(
      (row) => !locationSet || (row.location && locationSet.has(row.location)),
    )
    .map((row) => ({
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

  return { rows, truncated };
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

/** Every scoring event for the same cohort, trait-independent - the
 * denominator `countMissingObservations` below needs to report a real "n
 * missing" rather than inventing one. */
export async function countCohortEvaluations(
  client: SupabaseClient,
  filters: AnalyticsFilters,
): Promise<number> {
  const { data, error } = await client.rpc("program_evaluation_dataset", {
    target_program_id: filters.programId,
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    include_archived: filters.includeArchived,
    row_limit: MAX_OBSERVATION_ROWS,
  });
  if (error || !data) return 0;
  const rows = data as EvaluationRpcRow[];
  const familySet = filters.familyIds?.length
    ? new Set(filters.familyIds)
    : null;
  const seedLotSet = filters.seedLotIds?.length
    ? new Set(filters.seedLotIds)
    : null;
  const blockSet = filters.blocks?.length ? new Set(filters.blocks) : null;
  const replicateSet = filters.replicates?.length
    ? new Set(filters.replicates)
    : null;
  const locationSet = filters.locations?.length
    ? new Set(filters.locations)
    : null;
  return rows.filter(
    (row) =>
      (!familySet || (row.family_id && familySet.has(row.family_id))) &&
      (!seedLotSet || (row.seed_lot_id && seedLotSet.has(row.seed_lot_id))) &&
      (!blockSet || (row.block && blockSet.has(row.block))) &&
      (!replicateSet ||
        (row.replicate != null && replicateSet.has(row.replicate))) &&
      (!locationSet || (row.location && locationSet.has(row.location))),
  ).length;
}

export type FilterOptions = {
  families: string[];
  seedLots: string[];
  blocks: string[];
  replicates: number[];
  locations: string[];
};

/** Distinct filter option values present in an already-fetched (date-range
 * scoped, pre-secondary-filter) dataset - never a second, unbounded query. */
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
