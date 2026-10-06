"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";

const id = z.string().uuid();
export async function createInitialModel(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ program_id: id, name: z.string().trim().min(1).max(160) })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("create_initial_selection_model", {
      target_program_id: values.program_id,
      model_name: values.name,
    });
    if (error) throw new Error("Création du modèle refusée.");
    return actionSuccess("Modèle créé avec les critères V1.");
  } catch (error) {
    return actionError(error, "Impossible de créer ce modèle.");
  }
}

export async function updateCriterion(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        criterion_id: id,
        coefficient: z.coerce.number().positive().max(100),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("update_selection_criterion", {
      target_criterion_id: values.criterion_id,
      new_coefficient: values.coefficient,
    });
    if (error) {
      console.error("update_selection_criterion failed", {
        code: error.code,
        message: error.message,
      });
      throw new Error("Modification du critère refusée.");
    }
    return actionSuccess("Coefficient mis à jour.");
  } catch (error) {
    return actionError(error, "Modification du critère refusée.");
  }
}

export async function createPhenotype(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        family_id: id,
        seed_lot_id: id,
        block: z.string().trim().max(40),
        replicate: z.coerce.number().int().positive().max(1000),
        location: z.string().trim().max(160),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("phenotypes").insert(values);
    if (error) throw new Error("Création du phénotype refusée.");
    return actionSuccess("Phénotype créé et disponible pour l’évaluation.");
  } catch (error) {
    return actionError(error, "Création du phénotype refusée.");
  }
}

export async function evaluatePhenotype(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const phenotypeId = id.parse(form.get("phenotype_id"));
    const modelId = id.parse(form.get("model_id"));
    const evaluationDate = z.string().date().parse(form.get("evaluation_date"));
    const entries = [...form.entries()].filter(([key]) =>
      key.startsWith("score:"),
    );
    const scores = Object.fromEntries(
      entries.map(([key, value]) => [
        key.slice(6),
        z.coerce.number().parse(value),
      ]),
    );
    const { client } = await requireIdentity();
    const { error } = await client.rpc("submit_phenotype_evaluation", {
      target_phenotype_id: phenotypeId,
      target_model_id: modelId,
      target_date: evaluationDate,
      submitted_scores: scores,
    });
    if (error) {
      console.error("submit_phenotype_evaluation failed", {
        code: error.code,
        message: error.message,
      });
      throw new Error("Évaluation refusée. Vérifiez tous les scores.");
    }
    return actionSuccess(
      "Évaluation enregistrée. Le score et la décision ont été calculés par PostgreSQL.",
    );
  } catch (error) {
    return actionError(error, "Évaluation refusée. Vérifiez tous les scores.");
  }
}

// ───────────────────────── Configurable phenotyping ─────────────────────────

const categories = [
  "morphology",
  "development",
  "flowering",
  "yield",
  "quality",
  "disease_resistance",
  "stress_tolerance",
  "seed",
  "physiology",
  "architecture",
  "other",
] as const;
const dataTypes = [
  "numeric",
  "integer",
  "ordinal",
  "categorical",
  "boolean",
  "date",
  "text",
] as const;
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable(),
  );
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().finite().nullable(),
);

// Trait metadata is validated here for clear messages and again by PostgreSQL
// constraints, which remain authoritative.
const traitSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_]{0,59}$/, "Code : minuscules, chiffres et _"),
    description: optionalText(1000),
    category: z.enum(categories),
    data_type: z.enum(dataTypes),
    unit: optionalText(30),
    minimum_value: optionalNumber,
    maximum_value: optionalNumber,
    decimal_places: z.preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.coerce.number().int().min(0).max(6).nullable(),
    ),
    allowed_values: optionalText(1000),
    direction: z.enum([
      "higher_is_better",
      "lower_is_better",
      "target_value",
      "neutral",
    ]),
    target_value: optionalNumber,
    protocol: optionalText(2000),
  })
  .transform((trait) => {
    const ranged = ["numeric", "integer", "ordinal"].includes(trait.data_type);
    const values =
      trait.data_type === "categorical"
        ? (trait.allowed_values ?? "")
            .split(/[\n,;]/)
            .map((value) => value.trim())
            .filter(Boolean)
        : null;
    return {
      ...trait,
      unit: ranged ? trait.unit : null,
      minimum_value: ranged ? trait.minimum_value : null,
      maximum_value: ranged ? trait.maximum_value : null,
      decimal_places:
        trait.data_type === "numeric" ? trait.decimal_places : null,
      allowed_values: values,
      direction: ranged ? trait.direction : "neutral",
      target_value:
        ranged && trait.direction === "target_value"
          ? trait.target_value
          : null,
    };
  })
  .superRefine((trait, context) => {
    if (
      trait.minimum_value != null &&
      trait.maximum_value != null &&
      trait.minimum_value > trait.maximum_value
    )
      context.addIssue({
        code: "custom",
        path: ["maximum_value"],
        message: "Le maximum doit être supérieur au minimum.",
      });
    if (
      trait.data_type === "ordinal" &&
      (trait.minimum_value == null ||
        trait.maximum_value == null ||
        !Number.isInteger(trait.minimum_value) ||
        !Number.isInteger(trait.maximum_value))
    )
      context.addIssue({
        code: "custom",
        path: ["minimum_value"],
        message: "Une échelle ordinale exige des bornes entières.",
      });
    if (
      trait.data_type === "categorical" &&
      (trait.allowed_values?.length ?? 0) < 2
    )
      context.addIssue({
        code: "custom",
        path: ["allowed_values"],
        message: "Indiquez au moins deux valeurs autorisées.",
      });
    if (trait.direction === "target_value" && trait.target_value == null)
      context.addIssue({
        code: "custom",
        path: ["target_value"],
        message: "Indiquez la valeur cible.",
      });
  });

function rejected(scope: string, error: { code?: string; message?: string }) {
  console.error(`${scope} rejected`, { code: error.code });
  if (error.code === "23505")
    return new Error("Ce code ou ce nom existe déjà dans votre équipe.");
  return new Error(`${scope} rejected`);
}

export async function createTrait(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = traitSchema.parse(Object.fromEntries(form));
    const { client, profile } = await requireIdentity();
    const { error } = await client.from("phenotype_traits").insert({
      ...values,
      organization_id: profile.organization_id,
      created_by: profile.id,
    });
    if (error) throw rejected("Trait creation", error);
    return actionSuccess(`Trait « ${values.name} » ajouté à la bibliothèque.`);
  } catch (error) {
    return actionError(
      error,
      error instanceof Error && error.message.includes("existe déjà")
        ? error.message
        : "Création du trait refusée.",
    );
  }
}

export async function updateTrait(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const traitId = id.parse(form.get("id"));
    const values = traitSchema.parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("phenotype_traits")
      .update(values)
      .eq("id", traitId)
      .select("id")
      .single();
    if (error || !data)
      throw rejected("Trait update", error ?? { code: "not_found" });
    return actionSuccess("Trait mis à jour.");
  } catch (error) {
    return actionError(
      error,
      error instanceof Error && error.message.includes("existe déjà")
        ? error.message
        : "Modification du trait refusée.",
    );
  }
}

async function setActive(
  table: "phenotype_traits" | "phenotyping_modules",
  form: FormData,
) {
  const values = z
    .object({ id, active: z.enum(["true", "false"]) })
    .parse(Object.fromEntries(form));
  const { client } = await requireIdentity();
  const { data, error } = await client
    .from(table)
    .update({ is_active: values.active === "true" })
    .eq("id", values.id)
    .select("id")
    .single();
  if (error || !data)
    throw rejected("Lifecycle", error ?? { code: "not_found" });
  return values.active === "true";
}

export async function setTraitActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    return actionSuccess(
      (await setActive("phenotype_traits", form))
        ? "Trait restauré."
        : "Trait archivé. Les observations existantes sont conservées.",
    );
  } catch (error) {
    return actionError(error, "Modification du trait refusée.");
  }
}

export async function setModuleActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    return actionSuccess(
      (await setActive("phenotyping_modules", form))
        ? "Module restauré."
        : "Module archivé. Les programmes ne l’affichent plus.",
    );
  } catch (error) {
    return actionError(error, "Modification du module refusée.");
  }
}

export async function createModule(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: optionalText(1000),
      })
      .parse(Object.fromEntries(form));
    const traitIds = z.array(id).parse(form.getAll("trait_id"));
    const { client, profile } = await requireIdentity();
    const { data, error } = await client
      .from("phenotyping_modules")
      .insert({
        ...values,
        organization_id: profile.organization_id,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error || !data)
      throw rejected("Module creation", error ?? { code: "unknown" });
    if (traitIds.length) {
      const { error: traitError } = await client
        .from("phenotyping_module_traits")
        .insert(
          traitIds.map((traitId, index) => ({
            module_id: data.id,
            trait_id: traitId,
            display_order: index + 1,
          })),
        );
      if (traitError) throw rejected("Module traits", traitError);
    }
    return actionSuccess(
      `Module « ${values.name} » créé avec ${traitIds.length} trait(s).`,
    );
  } catch (error) {
    return actionError(
      error,
      error instanceof Error && error.message.includes("existe déjà")
        ? error.message
        : "Création du module refusée.",
    );
  }
}

export async function changeModuleTrait(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        module_id: id,
        trait_id: id,
        operation: z.enum(["add", "remove", "up", "down"]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    if (values.operation === "add") {
      const { data: last } = await client
        .from("phenotyping_module_traits")
        .select("display_order")
        .eq("module_id", values.module_id)
        .order("display_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await client.from("phenotyping_module_traits").insert({
        module_id: values.module_id,
        trait_id: values.trait_id,
        display_order: (last?.display_order ?? 0) + 1,
      });
      if (error) throw rejected("Module trait add", error);
      return actionSuccess("Trait ajouté au module.");
    }
    if (values.operation === "remove") {
      const { data, error } = await client
        .from("phenotyping_module_traits")
        .delete()
        .eq("module_id", values.module_id)
        .eq("trait_id", values.trait_id)
        .select("trait_id");
      if (error || !data?.length)
        throw rejected("Module trait remove", error ?? { code: "not_found" });
      return actionSuccess("Trait retiré du module.");
    }
    const { error } = await client.rpc("move_module_trait", {
      target_module_id: values.module_id,
      target_trait_id: values.trait_id,
      step: values.operation === "up" ? -1 : 1,
    });
    if (error) throw rejected("Module trait move", error);
    return actionSuccess("Ordre mis à jour.");
  } catch (error) {
    return actionError(error, "Modification du module refusée.");
  }
}

export async function setProgramModule(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        module_id: id,
        active: z.enum(["true", "false"]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("program_phenotyping_modules").upsert(
      {
        program_id: values.program_id,
        module_id: values.module_id,
        is_active: values.active === "true",
      },
      { onConflict: "program_id,module_id" },
    );
    if (error) throw rejected("Program module", error);
    return actionSuccess(
      values.active === "true"
        ? "Module activé pour ce programme."
        : "Module désactivé pour ce programme. Les observations restent conservées.",
    );
  } catch (error) {
    return actionError(error, "Configuration du programme refusée.");
  }
}

export async function setTraitWeight(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        trait_id: id,
        coefficient: optionalNumber,
      })
      .parse(Object.fromEntries(form));
    if (
      values.coefficient != null &&
      (values.coefficient <= 0 || values.coefficient > 100)
    )
      return {
        status: "error",
        message: "Le poids doit être compris entre 0,1 et 100.",
      };
    const { client } = await requireIdentity();
    const { error } = await client.rpc("set_program_trait_weight", {
      target_program_id: values.program_id,
      target_trait_id: values.trait_id,
      new_coefficient: values.coefficient,
    });
    if (error) {
      console.error("set_program_trait_weight rejected", { code: error.code });
      return {
        status: "error",
        message:
          error.code === "23514"
            ? "Poids refusé : le programme doit avoir un modèle actif, le trait doit être numérique borné et au moins un trait doit rester pondéré."
            : "Poids refusé.",
      };
    }
    return actionSuccess(
      values.coefficient == null
        ? "Trait retiré du score : il reste observé."
        : "Poids enregistré. Le score maximal du modèle a été recalculé.",
    );
  } catch (error) {
    return actionError(error, "Poids refusé.");
  }
}

type ActiveTrait = {
  code: string;
  data_type: (typeof dataTypes)[number];
};

// Builds the typed JSON payload from `trait:<code>` fields using the program's
// active trait metadata; PostgreSQL re-validates bounds, precision and values.
export async function submitTraitEvaluation(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const base = z
      .object({
        phenotype_id: id,
        program_id: id,
        evaluation_date: z.string().date(),
        notes: optionalText(1000),
      })
      .parse({
        phenotype_id: form.get("phenotype_id"),
        program_id: form.get("program_id"),
        evaluation_date: form.get("evaluation_date"),
        notes: form.get("notes") ?? "",
      });
    const { client } = await requireIdentity();
    const { data: traits, error: traitsError } = await client.rpc(
      "program_active_traits",
      { target_program_id: base.program_id },
    );
    if (traitsError) throw rejected("Active traits", traitsError);
    const fieldErrors: Record<string, string[]> = {};
    const payload: Record<string, unknown> = {};
    for (const trait of (traits ?? []) as ActiveTrait[]) {
      const field = `trait:${trait.code}`;
      const raw = form.get(field);
      if (raw === null || String(raw).trim() === "") continue;
      const text = String(raw).trim();
      if (["numeric", "integer", "ordinal"].includes(trait.data_type)) {
        const number = Number(text.replace(",", "."));
        if (!Number.isFinite(number)) fieldErrors[field] = ["Nombre attendu."];
        else payload[trait.code] = number;
      } else if (trait.data_type === "boolean") {
        if (text !== "true" && text !== "false")
          fieldErrors[field] = ["Oui ou non attendu."];
        else payload[trait.code] = text === "true";
      } else payload[trait.code] = text;
    }
    if (Object.keys(fieldErrors).length)
      return {
        status: "error",
        message: "Vérifiez les champs signalés.",
        fieldErrors,
      };
    if (!Object.keys(payload).length)
      return {
        status: "error",
        message: "Renseignez au moins une mesure.",
      };
    const { data: evaluationId, error } = await client.rpc(
      "submit_trait_evaluation",
      {
        target_phenotype_id: base.phenotype_id,
        target_date: base.evaluation_date,
        submitted_values: payload,
        evaluation_notes: base.notes,
      },
    );
    if (error) {
      console.error("submit_trait_evaluation rejected", { code: error.code });
      return {
        status: "error",
        message:
          "Évaluation refusée : une valeur est hors limites, trop précise ou non autorisée pour ce trait.",
      };
    }
    const { data: evaluation } = await client
      .from("phenotype_evaluations")
      .select("selection_model_id,automatic_decision,normalized_score")
      .eq("id", evaluationId)
      .single();
    return actionSuccess(
      evaluation?.selection_model_id
        ? `Évaluation enregistrée et classée par PostgreSQL : ${evaluation.normalized_score} %, décision ${evaluation.automatic_decision}.`
        : "Observations enregistrées. Non classée : tous les traits pondérés du modèle n’ont pas été mesurés.",
    );
  } catch (error) {
    return actionError(error, "Évaluation refusée.");
  }
}
