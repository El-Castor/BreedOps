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

interface OfflineProgramConfigurationRow {
  fingerprint: string;
  active_traits: ActiveTraitRow[];
}

export interface OfflineProgramConfiguration {
  activeTraits: OfflineTraitDefinition[];
  configFingerprint: string;
}

function mapActiveTrait(row: ActiveTraitRow): OfflineTraitDefinition {
  return {
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
  };
}

/**
 * Loads the field-pack trait snapshot and its authoritative configuration
 * fingerprint from one PostgreSQL statement snapshot.
 *
 * The fingerprint is deliberately NOT recomputed from activeTraits in
 * TypeScript: PostgreSQL also includes the active selection model, criteria,
 * coefficients, eliminatory gates and decision rules, which affect the
 * scientific result of submit_trait_evaluation() but are not needed by the
 * offline field form itself.
 */
export async function fetchOfflineProgramConfiguration(
  client: Awaited<ReturnType<typeof createClient>>,
  programId: string,
): Promise<OfflineProgramConfiguration> {
  const { data, error } = await client.rpc(
    "offline_sync_program_configuration",
    {
      p_program_id: programId,
    },
  );

  if (error || !data) {
    throw new Error(
      "Impossible de charger la configuration hors ligne du programme.",
    );
  }

  const snapshot = data as unknown as OfflineProgramConfigurationRow;

  if (
    typeof snapshot.fingerprint !== "string" ||
    snapshot.fingerprint.length === 0 ||
    !Array.isArray(snapshot.active_traits)
  ) {
    throw new Error(
      "La configuration hors ligne retournée par le serveur est invalide.",
    );
  }

  return {
    activeTraits: snapshot.active_traits.map(mapActiveTrait),
    configFingerprint: snapshot.fingerprint,
  };
}
