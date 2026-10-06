"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";

const id = z.string().uuid();
const code = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);
const text = z.string().trim().min(1).max(160);
const optionalInt = z.preprocess(
  (v) => (v === "" ? null : v),
  z.coerce.number().int().min(0).max(1_000_000).nullable(),
);
const date = z.string().date();

async function insert(table: string, values: Record<string, unknown>) {
  const { client } = await requireIdentity();
  const { error } = await client.from(table).insert(values);
  if (error) {
    const { data: currentTeam } = await client.rpc("current_team_id");
    console.error("BreedOps mutation rejected", {
      table,
      code: error.code,
      message: error.message,
      authenticatedTeamResolved: Boolean(currentTeam),
      teamMatchesPayload: currentTeam === values.organization_id,
    });
  }
  if (error) throw error;
}

const codeColumns = {
  parent_lines: "parent_code",
  crosses: "cross_code",
  families: "family_code",
  seed_lots: "seed_lot_code",
} as const;

// PostgreSQL assigns the business code; the generated value is read back so the
// user sees the identifier without ever choosing it in the browser.
async function insertWithGeneratedCode(
  table: keyof typeof codeColumns,
  values: Record<string, unknown>,
) {
  const { client } = await requireIdentity();
  const column = codeColumns[table];
  const { data, error } = await client
    .from(table)
    .insert(values)
    .select(column)
    .single();
  if (error || !data) {
    console.error("BreedOps mutation rejected", { table, code: error?.code });
    throw error ?? new Error("Generated code unavailable");
  }
  return (data as Record<string, string>)[column];
}

export async function createProgram(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const { profile } = await requireIdentity();
    const values = z
      .object({
        code,
        name: text,
        species: text,
        campaign: z.string().trim().max(40),
      })
      .parse(Object.fromEntries(form));
    await insert("programs", {
      ...values,
      organization_id: profile.organization_id,
      created_by: profile.id,
    });
    return actionSuccess(
      "Programme créé. Vous pouvez maintenant ajouter ses lignées parentales.",
    );
  } catch (error) {
    return actionError(error, "Impossible de créer le programme.");
  }
}

export async function createParentLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        line_name: text,
        generation: optionalInt,
      })
      .parse(Object.fromEntries(form));
    const generated = await insertWithGeneratedCode("parent_lines", values);
    return actionSuccess(
      `Lignée ${generated} ajoutée. Les sélecteurs de croisement ont été actualisés.`,
    );
  } catch (error) {
    return actionError(error, "Impossible d’ajouter cette lignée.");
  }
}

export async function createCross(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        female_parent_id: id,
        male_parent_id: id,
        pollination_date: date,
        pollinated_units: optionalInt,
        established_units: optionalInt,
        total_seeds: optionalInt,
      })
      .parse(Object.fromEntries(form));
    if (values.female_parent_id === values.male_parent_id)
      return {
        status: "error",
        message: "Sélectionnez deux lignées parentales différentes.",
      };
    const generated = await insertWithGeneratedCode("crosses", values);
    return actionSuccess(
      `Croisement ${generated} créé. Il est maintenant disponible pour créer une famille.`,
    );
  } catch (error) {
    return actionError(error, "Impossible de créer ce croisement.");
  }
}

export async function updateCross(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        id,
        status: z.enum(["planned", "active", "completed", "cancelled"]),
        notes: z.string().trim().max(1000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("crosses")
      .update({ status: values.status, notes: values.notes || null })
      .eq("id", values.id)
      .is("deleted_at", null)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Cross not found");
    return actionSuccess("Croisement mis à jour.");
  } catch (error) {
    return actionError(error, "Modification du croisement refusée.");
  }
}

export async function createFamily(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        cross_id: id,
        generation: optionalInt,
      })
      .parse(Object.fromEntries(form));
    const generated = await insertWithGeneratedCode("families", values);
    return actionSuccess(
      `Famille ${generated} créée. Elle est maintenant disponible pour créer un lot.`,
    );
  } catch (error) {
    return actionError(error, "Impossible de créer cette famille.");
  }
}

export async function createSeedLot(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        cross_id: id,
        family_id: id,
        harvest_date: date,
        total_quantity: z.coerce.number().nonnegative().max(1_000_000_000),
        storage_location: z.string().trim().max(160),
      })
      .parse(Object.fromEntries(form));
    const generated = await insertWithGeneratedCode("seed_lots", {
      ...values,
      quantity_unit: "seeds",
    });
    return actionSuccess(
      `Lot ${generated} créé. Vous pouvez enregistrer sa germination ou créer un phénotype.`,
    );
  } catch (error) {
    return actionError(error, "Impossible de créer ce lot.");
  }
}

const lifecycleEntity = z.enum([
  "parent_lines",
  "crosses",
  "families",
  "seed_lots",
]);

export async function setBreedingEntityArchived(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        entity: lifecycleEntity,
        id,
        operation: z.enum(["archive", "restore"]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from(values.entity)
      .update({
        deleted_at:
          values.operation === "archive" ? new Date().toISOString() : null,
      })
      .eq("id", values.id)
      .select("id")
      .single();
    if (error || !data) {
      console.error("BreedOps lifecycle mutation rejected", {
        entity: values.entity,
        operation: values.operation,
        code: error?.code,
      });
      throw new Error("Lifecycle mutation rejected");
    }
    return actionSuccess(
      values.operation === "archive"
        ? "Enregistrement archivé. Son historique reste conservé."
        : "Enregistrement restauré et de nouveau disponible.",
    );
  } catch (error) {
    return actionError(
      error,
      "Impossible de modifier le cycle de vie de cet enregistrement.",
    );
  }
}

export async function createGerminationTest(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const { profile } = await requireIdentity();
    const values = z
      .object({
        seed_lot_id: id,
        test_date: date,
        evaluation_day: z.coerce.number().int().min(0).max(365),
        seeds_tested: z.coerce.number().int().positive().max(1_000_000),
        seeds_germinated: z.coerce.number().int().nonnegative().max(1_000_000),
        method: text,
      })
      .parse(Object.fromEntries(form));
    if (values.seeds_germinated > values.seeds_tested)
      return {
        status: "error",
        message: "Le nombre germé ne peut pas dépasser le nombre testé.",
      };
    await insert("germination_tests", { ...values, operator_id: profile.id });
    return actionSuccess(
      "Test enregistré et taux de germination calculé par PostgreSQL.",
    );
  } catch (error) {
    return actionError(error, "Impossible d’enregistrer ce test.");
  }
}
