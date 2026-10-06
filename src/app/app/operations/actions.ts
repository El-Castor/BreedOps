"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import {
  actionError,
  actionSuccess,
  type ActionState,
} from "@/lib/action-state";

const id = z.string().uuid();
const optionalId = id.or(z.literal(""));

export async function createCycle(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        name: z.string().trim().min(1).max(160),
        start_date: z.string().date(),
        end_date: z.string().date(),
      })
      .refine((v) => v.end_date >= v.start_date, { path: ["end_date"] })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycles")
      .insert({ ...values, status: "active" });
    if (error) throw new Error("Création du cycle refusée.");
    return actionSuccess(
      "Cycle créé. Vous pouvez maintenant planifier une tâche.",
    );
  } catch (error) {
    return actionError(error, "Impossible de créer ce cycle.");
  }
}

export async function createTask(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        experimental_cycle_id: id,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500),
        planned_date: z.string().date(),
        due_date: z.string().date(),
        assigned_to: optionalId,
        priority: z.enum(["low", "medium", "high", "critical"]),
        zone: z.string().trim().max(120),
      })
      .refine((v) => v.due_date >= v.planned_date, { path: ["due_date"] })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("tasks").insert({
      ...values,
      assigned_to: values.assigned_to || null,
      description: values.description || null,
      zone: values.zone || null,
      status: "not_started",
    });
    if (error) throw new Error("Création de la tâche refusée.");
    return actionSuccess("Tâche créée et ajoutée au calendrier.");
  } catch (error) {
    return actionError(error, "Impossible de créer cette tâche.");
  }
}

export async function updateTaskStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        task_id: id,
        status: z.enum([
          "not_started",
          "in_progress",
          "blocked",
          "completed",
          "cancelled",
        ]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("set_task_status", {
      target_task_id: values.task_id,
      new_status: values.status,
    });
    if (error) throw new Error("Mise à jour de la tâche refusée.");
    return actionSuccess("État de la tâche mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier cette tâche.");
  }
}
