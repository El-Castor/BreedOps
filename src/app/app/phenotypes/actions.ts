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
