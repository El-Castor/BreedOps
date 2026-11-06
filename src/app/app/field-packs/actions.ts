"use server";

import { requireIdentity } from "@/lib/auth";
import { buildOfflinePack } from "@/lib/offline/pack-builder";
import type {
  OfflinePack,
  OfflinePhenotypeEntry,
  OfflineTraitDefinition,
} from "@/lib/offline/types";

export type { OfflinePack };

interface TrialRow {
  id: string;
  code: string;
  name: string;
  program_id: string;
  programs: { code: string; name: string } | null;
}

interface PhenotypeRow {
  id: string;
  phenotype_code: string;
  trial_entries: {
    code: string;
    label: string;
    seed_lot_id: string | null;
    family_id: string | null;
    parent_line_id: string | null;
  } | null;
  environments: { code: string; name: string } | null;
}

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

function resolveQr(
  entry: PhenotypeRow["trial_entries"],
): OfflinePhenotypeEntry["qr"] {
  if (!entry) return null;
  // Most specific first: a seed lot is a more precise physical identity
  // than the family or parent it descends from.
  if (entry.seed_lot_id)
    return { entityType: "seed_lot", entityId: entry.seed_lot_id };
  if (entry.family_id)
    return { entityType: "family", entityId: entry.family_id };
  if (entry.parent_line_id)
    return { entityType: "parent", entityId: entry.parent_line_id };
  return null;
}

function entryLabel(row: PhenotypeRow): string {
  const entry = row.trial_entries;
  if (!entry) return row.phenotype_code;
  const base = `${entry.code} — ${entry.label}`;
  return row.environments ? `${base} (${row.environments.code})` : base;
}

/** Fetches a trial's current phenotyping configuration and builds the
 * offline pack a user explicitly asked to make available in the field
 * (V2-07 §7). Entirely a read: nothing is persisted server-side by this
 * call, and nothing is written to the caller's IndexedDB here - the
 * client does that once this data arrives (src/app/field-packs). Scoped
 * exclusively by requireIdentity() + RLS (trials/trial_entries/phenotypes/
 * program_active_traits every RLS-filtered by the caller's own program
 * access) - never a client-asserted program/trial id taken on trust. */
export async function buildFieldOfflinePack(
  trialId: string,
): Promise<OfflinePack> {
  const { client, profile } = await requireIdentity();

  const { data: trial, error: trialError } = await client
    .from("trials")
    .select("id,code,name,program_id,programs(code,name)")
    .eq("id", trialId)
    .is("deleted_at", null)
    .maybeSingle<TrialRow>();
  if (trialError || !trial) {
    throw new Error("Essai introuvable ou inaccessible.");
  }

  const { data: phenotypeRows, error: phenotypesError } = await client
    .from("phenotypes")
    .select(
      "id,phenotype_code,trial_entries!inner(code,label,seed_lot_id,family_id,parent_line_id,trial_id),environments(code,name)",
    )
    .eq("trial_entries.trial_id", trialId)
    .is("deleted_at", null)
    .order("phenotype_code");
  if (phenotypesError) {
    throw new Error("Impossible de charger les phénotypes de cet essai.");
  }

  const { data: traitRows, error: traitsError } = await client.rpc(
    "program_active_traits",
    { target_program_id: trial.program_id },
  );
  if (traitsError) {
    throw new Error("Impossible de charger les traits actifs du programme.");
  }

  const entries: OfflinePhenotypeEntry[] = (
    (phenotypeRows ?? []) as unknown as PhenotypeRow[]
  ).map((row) => ({
    phenotypeId: row.id,
    phenotypeCode: row.phenotype_code,
    label: entryLabel(row),
    qr: resolveQr(row.trial_entries),
  }));

  const activeTraits: OfflineTraitDefinition[] = (
    (traitRows ?? []) as ActiveTraitRow[]
  ).map((row) => ({
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

  return buildOfflinePack({
    profileId: profile.id,
    organizationId: profile.organization_id,
    programId: trial.program_id,
    programCode: trial.programs?.code ?? "",
    programName: trial.programs?.name ?? "",
    trialId: trial.id,
    trialCode: trial.code,
    trialName: trial.name,
    entries,
    activeTraits,
  });
}
