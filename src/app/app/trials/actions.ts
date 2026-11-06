"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";

const id = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max);
const codeText = z.string().trim().min(1).max(40);
const nameText = z.string().trim().min(1).max(200);

export async function createSite(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        organization_id: id,
        code: codeText,
        name: nameText,
        description: optionalText(2000),
      })
      .parse(Object.fromEntries(form));
    const { client, team } = await requireIdentity();
    if (team.id !== values.organization_id) throw new Error("Équipe invalide.");
    const { error } = await client.from("sites").insert({
      organization_id: values.organization_id,
      code: values.code,
      name: values.name,
      description: values.description || null,
    });
    if (error) throw new Error("Création du site refusée.");
    return actionSuccess("Site créé.");
  } catch (error) {
    return actionError(error, "Impossible de créer ce site.");
  }
}

export async function createEnvironment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        site_id: id,
        code: codeText,
        name: nameText,
        campaign: optionalText(40),
        management_context: optionalText(2000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("environments").insert({
      program_id: values.program_id,
      site_id: values.site_id,
      code: values.code,
      name: values.name,
      campaign: values.campaign || null,
      management_context: values.management_context || null,
    });
    if (error) throw new Error("Création de l’environnement refusée.");
    return actionSuccess("Environnement créé.");
  } catch (error) {
    return actionError(error, "Impossible de créer cet environnement.");
  }
}

export async function createTrial(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        code: codeText,
        name: nameText,
        description: optionalText(2000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("trials").insert({
      program_id: values.program_id,
      code: values.code,
      name: values.name,
      description: values.description || null,
    });
    if (error) throw new Error("Création de l’essai refusée.");
    return actionSuccess("Essai multi-environnement créé.");
  } catch (error) {
    return actionError(error, "Impossible de créer cet essai.");
  }
}

export async function addTrialEnvironment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ trial_id: id, environment_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("trial_environments").insert(values);
    if (error) throw new Error("Ajout de l’environnement à l’essai refusé.");
    return actionSuccess("Environnement ajouté à l’essai.");
  } catch (error) {
    return actionError(error, "Impossible d’ajouter cet environnement.");
  }
}

export async function removeTrialEnvironment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ trial_id: id, environment_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("trial_environments")
      .delete()
      .eq("trial_id", values.trial_id)
      .eq("environment_id", values.environment_id);
    if (error) throw new Error("Retrait de l’environnement refusé.");
    return actionSuccess("Environnement retiré de l’essai.");
  } catch (error) {
    return actionError(error, "Impossible de retirer cet environnement.");
  }
}

export async function createTrialEntry(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        trial_id: id,
        code: codeText,
        label: nameText,
        scientific_role: z.enum([
          "genotype",
          "family",
          "population",
          "seed_lot",
          "other",
        ]),
        parent_line_id: id.nullable(),
        family_id: id.nullable(),
        seed_lot_id: id.nullable(),
      })
      .parse({
        trial_id: form.get("trial_id"),
        code: form.get("code"),
        label: form.get("label"),
        scientific_role: form.get("scientific_role"),
        parent_line_id: form.get("parent_line_id") || null,
        family_id: form.get("family_id") || null,
        seed_lot_id: form.get("seed_lot_id") || null,
      });
    const { client } = await requireIdentity();
    const { error } = await client.from("trial_entries").insert(values);
    if (error) throw new Error("Création de l’entrée refusée.");
    return actionSuccess("Entrée ajoutée à l’essai.");
  } catch (error) {
    return actionError(error, "Impossible de créer cette entrée.");
  }
}

export type SiteOption = { id: string; code: string; name: string };
export type EnvironmentOption = {
  id: string;
  code: string;
  name: string;
  siteId: string;
  siteCode: string;
  campaign: string | null;
};
export type TrialOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};
export type TrialEntryRow = {
  id: string;
  code: string;
  label: string;
  scientificRole: string;
};

export async function listSites(organizationId: string): Promise<SiteOption[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("sites")
    .select("id,code,name")
    .eq("organization_id", organizationId)
    .order("code");
  if (error || !data) return [];
  return data as SiteOption[];
}

export async function listEnvironments(
  programId: string,
): Promise<EnvironmentOption[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("environments")
    .select("id,code,name,campaign,site_id,sites(code)")
    .eq("program_id", programId)
    .order("code");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    campaign: row.campaign as string | null,
    siteId: row.site_id as string,
    siteCode: (row.sites as { code: string } | null)?.code ?? "—",
  }));
}

export async function listTrials(programId: string): Promise<TrialOption[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("trials")
    .select("id,code,name,description")
    .eq("program_id", programId)
    .order("code");
  if (error || !data) return [];
  return data as TrialOption[];
}

export async function listTrialEnvironments(
  trialId: string,
): Promise<EnvironmentOption[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("trial_environments")
    .select("environments(id,code,name,campaign,site_id,sites(code))")
    .eq("trial_id", trialId);
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .map((row) => row.environments as Record<string, unknown> | null)
    .filter((env): env is Record<string, unknown> => env != null)
    .map((env) => ({
      id: env.id as string,
      code: env.code as string,
      name: env.name as string,
      campaign: env.campaign as string | null,
      siteId: env.site_id as string,
      siteCode: (env.sites as { code: string } | null)?.code ?? "—",
    }));
}

export async function listTrialEntries(
  trialId: string,
): Promise<TrialEntryRow[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from("trial_entries")
    .select("id,code,label,scientific_role")
    .eq("trial_id", trialId)
    .order("code");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    code: row.code as string,
    label: row.label as string,
    scientificRole: row.scientific_role as string,
  }));
}

// ───────────────────────── Legacy mapping workflow (B41) ─────────────────────────
// phenotypes.location (free text) and family_id/seed_lot_id are never
// auto-migrated into the normalized sites/environments/trial_entries
// model - a human explicitly maps each distinct legacy value, once,
// through this workflow. Every mapping call below goes through the
// migration 000029 SQL functions, which run SECURITY INVOKER: the
// caller's own phenotypes_update RLS policy and the
// validate_phenotype_met_links trigger both still apply.

export type UnmappedLocation = { location: string; phenotypeCount: number };

export async function listUnmappedLocations(
  programId: string,
): Promise<UnmappedLocation[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client.rpc(
    "legacy_phenotype_location_summary",
    { target_program_id: programId },
  );
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    location: row.location as string,
    phenotypeCount: Number(row.phenotype_count),
  }));
}

export type UnmappedMaterial = {
  familyId: string | null;
  familyCode: string | null;
  seedLotId: string | null;
  seedLotCode: string | null;
  phenotypeCount: number;
};

export async function listUnmappedMaterial(
  programId: string,
): Promise<UnmappedMaterial[]> {
  const { client } = await requireIdentity();
  const { data, error } = await client.rpc(
    "legacy_phenotype_material_summary",
    { target_program_id: programId },
  );
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    familyId: row.family_id as string | null,
    familyCode: row.family_code as string | null,
    seedLotId: row.seed_lot_id as string | null,
    seedLotCode: row.seed_lot_code as string | null,
    phenotypeCount: Number(row.phenotype_count),
  }));
}

export async function mapLegacyLocation(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        location: z.string().trim().min(1),
        environment_id: id,
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { data, error } = await client.rpc(
      "map_legacy_location_to_environment",
      {
        target_program_id: values.program_id,
        target_location: values.location,
        target_environment_id: values.environment_id,
      },
    );
    if (error) throw new Error("Correspondance d’emplacement refusée.");
    return actionSuccess(`${data} phénotype(s) lié(s) à cet environnement.`);
  } catch (error) {
    return actionError(
      error,
      "Impossible d’appliquer cette correspondance d’emplacement.",
    );
  }
}

export async function mapLegacyMaterial(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        family_id: id.nullable(),
        seed_lot_id: id.nullable(),
        trial_entry_id: id,
      })
      .parse({
        program_id: form.get("program_id"),
        family_id: form.get("family_id") || null,
        seed_lot_id: form.get("seed_lot_id") || null,
        trial_entry_id: form.get("trial_entry_id"),
      });
    const { client } = await requireIdentity();
    const { data, error } = await client.rpc(
      "map_legacy_material_to_trial_entry",
      {
        target_program_id: values.program_id,
        target_family_id: values.family_id,
        target_seed_lot_id: values.seed_lot_id,
        target_trial_entry_id: values.trial_entry_id,
      },
    );
    if (error) throw new Error("Correspondance de matériel refusée.");
    return actionSuccess(`${data} phénotype(s) lié(s) à cette entrée.`);
  } catch (error) {
    return actionError(
      error,
      "Impossible d’appliquer cette correspondance de matériel.",
    );
  }
}
