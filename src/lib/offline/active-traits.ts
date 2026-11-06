import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { OfflineTraitDefinition } from "./types";

interface ActiveTraitRow {
  trait_id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  data_type: string;
  unit: string | null;
  minimum_value: number | null;
  maximum_value: number | null;
  decimal_places: number | null;
  allowed_values: string[] | null;
  direction: string | null;
  target_value: number | null;
  protocol: string | null;
  module_id: string;
  module_name: string;
  module_order: number;
  trait_order: number;
}

/** Fetches and maps `program_active_traits()` (000016) to the camelCase
 * shape the offline pack/sync layer shares. The single source of this
 * mapping - both the pack-build action (src/app/app/field-packs/actions.ts)
 * and the sync endpoint's CONFIG_CHANGED check
 * (src/app/api/offline-sync/route.ts) call this, specifically so the two
 * can never independently drift out of sync with each other (the same
 * failure mode V2-06's hardening review targeted: two divergent copies of
 * one mapping silently disagreeing). */
export async function fetchActiveOfflineTraits(
  client: Awaited<ReturnType<typeof createClient>>,
  programId: string,
): Promise<OfflineTraitDefinition[]> {
  const { data, error } = await client.rpc("program_active_traits", {
    target_program_id: programId,
  });
  if (error) {
    throw new Error("Impossible de charger les traits actifs du programme.");
  }
  return ((data ?? []) as ActiveTraitRow[]).map((row) => ({
    traitId: row.trait_id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    dataType: row.data_type as OfflineTraitDefinition["dataType"],
    unit: row.unit,
    minimumValue: row.minimum_value,
    maximumValue: row.maximum_value,
    decimalPlaces: row.decimal_places,
    allowedValues: row.allowed_values,
    direction: row.direction,
    targetValue: row.target_value,
    protocol: row.protocol,
    moduleId: row.module_id,
    moduleName: row.module_name,
    moduleOrder: row.module_order,
    traitOrder: row.trait_order,
  }));
}
