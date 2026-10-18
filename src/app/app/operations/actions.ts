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
    if (error) {
      // set_task_status raises this exact French message when required
      // checklist items are incomplete; show it verbatim instead of the
      // generic fallback.
      if (error.message.includes("contrôles obligatoires non terminés"))
        return actionError(error, error.message);
      throw new Error("Mise à jour de la tâche refusée.");
    }
    return actionSuccess("État de la tâche mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier cette tâche.");
  }
}

const dateString = z.string().date();
const scheduleErrorMessages = [
  "tâche est terminée",
  "respecter les dépendances",
  "tâche déjà terminée",
];

export async function createTaskTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
        zone: z.string().trim().max(120),
        priority: z.enum(["low", "medium", "high", "critical"]),
        sop_code: z.string().trim().max(60),
        expected_deliverable: z.string().trim().max(500),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("task_templates").insert({
      ...values,
      description: values.description || null,
      zone: values.zone || null,
      sop_code: values.sop_code || null,
      expected_deliverable: values.expected_deliverable || null,
    });
    if (error) throw new Error("Création du modèle de tâche refusée.");
    return actionSuccess("Modèle de tâche créé.");
  } catch (error) {
    return actionError(error, "Impossible de créer ce modèle de tâche.");
  }
}

export async function updateTaskTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        task_template_id: id,
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
        zone: z.string().trim().max(120),
        priority: z.enum(["low", "medium", "high", "critical"]),
        sop_code: z.string().trim().max(60),
        expected_deliverable: z.string().trim().max(500),
        is_active: z.union([z.literal("true"), z.literal("false")]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("task_templates")
      .update({
        code: values.code,
        name: values.name,
        description: values.description || null,
        zone: values.zone || null,
        priority: values.priority,
        sop_code: values.sop_code || null,
        expected_deliverable: values.expected_deliverable || null,
        is_active: values.is_active === "true",
      })
      .eq("id", values.task_template_id);
    if (error) throw new Error("Modification du modèle de tâche refusée.");
    return actionSuccess("Modèle de tâche mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier ce modèle de tâche.");
  }
}

export async function archiveTaskTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ task_template_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("task_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", values.task_template_id);
    if (error) throw new Error("Archivage du modèle de tâche refusé.");
    return actionSuccess("Modèle de tâche archivé.");
  } catch (error) {
    return actionError(error, "Impossible d’archiver ce modèle de tâche.");
  }
}

export async function restoreTaskTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ task_template_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("task_templates")
      .update({ deleted_at: null })
      .eq("id", values.task_template_id);
    if (error) throw new Error("Restauration du modèle de tâche refusée.");
    return actionSuccess("Modèle de tâche restauré.");
  } catch (error) {
    return actionError(error, "Impossible de restaurer ce modèle de tâche.");
  }
}

export async function addTemplateChecklistItem(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        task_template_id: id,
        label: z.string().trim().min(1).max(300),
        is_required: z.union([z.literal("true"), z.literal("false")]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { count } = await client
      .from("task_template_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("task_template_id", values.task_template_id);
    const { error } = await client
      .from("task_template_checklist_items")
      .insert({
        task_template_id: values.task_template_id,
        label: values.label,
        is_required: values.is_required === "true",
        sort_order: count ?? 0,
      });
    if (error) throw new Error("Ajout du contrôle refusé.");
    return actionSuccess("Contrôle ajouté au modèle.");
  } catch (error) {
    return actionError(error, "Impossible d’ajouter ce contrôle.");
  }
}

export async function removeTemplateChecklistItem(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z.object({ item_id: id }).parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("task_template_checklist_items")
      .delete()
      .eq("id", values.item_id);
    if (error) throw new Error("Suppression du contrôle refusée.");
    return actionSuccess("Contrôle supprimé du modèle.");
  } catch (error) {
    return actionError(error, "Impossible de supprimer ce contrôle.");
  }
}

export async function createCycleTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        program_id: id,
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.from("experimental_cycle_templates").insert({
      ...values,
      description: values.description || null,
    });
    if (error) throw new Error("Création du modèle de cycle refusée.");
    return actionSuccess("Modèle de cycle créé. Ajoutez-y des étapes.");
  } catch (error) {
    return actionError(error, "Impossible de créer ce modèle de cycle.");
  }
}

export async function updateCycleTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        cycle_template_id: id,
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
        is_active: z.union([z.literal("true"), z.literal("false")]),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_templates")
      .update({
        code: values.code,
        name: values.name,
        description: values.description || null,
        is_active: values.is_active === "true",
      })
      .eq("id", values.cycle_template_id);
    if (error) throw new Error("Modification du modèle de cycle refusée.");
    return actionSuccess("Modèle de cycle mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier ce modèle de cycle.");
  }
}

export async function archiveCycleTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ cycle_template_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", values.cycle_template_id);
    if (error) throw new Error("Archivage du modèle de cycle refusé.");
    return actionSuccess(
      "Modèle de cycle archivé. Les cycles déjà générés ne sont pas affectés.",
    );
  } catch (error) {
    return actionError(error, "Impossible d’archiver ce modèle de cycle.");
  }
}

export async function restoreCycleTemplate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ cycle_template_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_templates")
      .update({ deleted_at: null })
      .eq("id", values.cycle_template_id);
    if (error) throw new Error("Restauration du modèle de cycle refusée.");
    return actionSuccess("Modèle de cycle restauré.");
  } catch (error) {
    return actionError(error, "Impossible de restaurer ce modèle de cycle.");
  }
}

export async function addCycleTemplateStep(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        cycle_template_id: id,
        task_template_id: id,
        start_offset_days: z.coerce.number().int().min(0).max(3650),
        duration_days: z.coerce.number().int().min(1).max(365),
        default_assigned_to: optionalId,
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { count } = await client
      .from("experimental_cycle_template_tasks")
      .select("id", { count: "exact", head: true })
      .eq("cycle_template_id", values.cycle_template_id);
    const { error } = await client
      .from("experimental_cycle_template_tasks")
      .insert({
        cycle_template_id: values.cycle_template_id,
        task_template_id: values.task_template_id,
        start_offset_days: values.start_offset_days,
        duration_days: values.duration_days,
        default_assigned_to: values.default_assigned_to || null,
        sort_order: count ?? 0,
      });
    if (error) throw new Error("Ajout de l’étape refusé.");
    return actionSuccess("Étape ajoutée au modèle de cycle.");
  } catch (error) {
    return actionError(error, "Impossible d’ajouter cette étape.");
  }
}

export async function updateCycleTemplateStep(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        template_task_id: id,
        start_offset_days: z.coerce.number().int().min(0).max(3650),
        duration_days: z.coerce.number().int().min(1).max(365),
        default_assigned_to: optionalId,
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_template_tasks")
      .update({
        start_offset_days: values.start_offset_days,
        duration_days: values.duration_days,
        default_assigned_to: values.default_assigned_to || null,
      })
      .eq("id", values.template_task_id);
    if (error) throw new Error("Modification de l’étape refusée.");
    return actionSuccess("Étape mise à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier cette étape.");
  }
}

export async function removeCycleTemplateStep(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ template_task_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_template_tasks")
      .delete()
      .eq("id", values.template_task_id);
    if (error)
      throw new Error(
        "Suppression de l’étape refusée (elle sert peut-être de dépendance).",
      );
    return actionSuccess("Étape supprimée du modèle de cycle.");
  } catch (error) {
    return actionError(error, "Impossible de supprimer cette étape.");
  }
}

export async function moveCycleTemplateStep(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        cycle_template_id: id,
        template_task_id: id,
        step: z.coerce
          .number()
          .int()
          .refine((v) => v === 1 || v === -1),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("move_cycle_template_task", {
      target_cycle_template_id: values.cycle_template_id,
      target_template_task_id: values.template_task_id,
      step: values.step,
    });
    if (error) throw new Error("Déplacement de l’étape refusé.");
    return actionSuccess("Ordre des étapes mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de déplacer cette étape.");
  }
}

export async function addTemplateDependency(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        cycle_template_id: id,
        predecessor_template_task_id: id,
        successor_template_task_id: id,
        lag_days: z.coerce.number().int().min(0).max(3650),
      })
      .refine(
        (v) => v.predecessor_template_task_id !== v.successor_template_task_id,
        {
          path: ["predecessor_template_task_id"],
          message: "Une étape ne peut pas dépendre d’elle-même.",
        },
      )
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_template_dependencies")
      .insert({
        cycle_template_id: values.cycle_template_id,
        predecessor_template_task_id: values.predecessor_template_task_id,
        successor_template_task_id: values.successor_template_task_id,
        lag_days: values.lag_days,
      });
    if (error)
      throw new Error(
        "Dépendance refusée : vérifiez qu’elle ne crée pas de cycle.",
      );
    return actionSuccess("Dépendance ajoutée.");
  } catch (error) {
    return actionError(error, "Impossible d’ajouter cette dépendance.");
  }
}

export async function removeTemplateDependency(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({ dependency_id: id })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("experimental_cycle_template_dependencies")
      .delete()
      .eq("id", values.dependency_id);
    if (error) throw new Error("Suppression de la dépendance refusée.");
    return actionSuccess("Dépendance supprimée.");
  } catch (error) {
    return actionError(error, "Impossible de supprimer cette dépendance.");
  }
}

export type SchedulePreviewRow = {
  templateTaskId: string;
  title: string;
  zone: string | null;
  priority: string;
  defaultAssignedTo: string | null;
  sortOrder: number;
  plannedDate: string;
  dueDate: string;
};

export async function previewCycleSchedule(
  templateIdInput: string,
  startDateInput: string,
): Promise<
  | { rows: SchedulePreviewRow[]; cycleEndDate: string | null }
  | { error: string }
> {
  try {
    const templateId = id.parse(templateIdInput);
    const startDate = dateString.parse(startDateInput);
    const { client } = await requireIdentity();
    const { data, error } = await client.rpc(
      "compute_cycle_template_schedule",
      {
        p_template_id: templateId,
        p_start_date: startDate,
      },
    );
    if (error) return { error: "Aperçu du calendrier impossible." };
    const rows = (data ?? []) as Array<{
      template_task_id: string;
      title: string;
      zone: string | null;
      priority: string;
      default_assigned_to: string | null;
      sort_order: number;
      planned_date: string;
      due_date: string;
    }>;
    const schedule: SchedulePreviewRow[] = rows.map((row) => ({
      templateTaskId: row.template_task_id,
      title: row.title,
      zone: row.zone,
      priority: row.priority,
      defaultAssignedTo: row.default_assigned_to,
      sortOrder: row.sort_order,
      plannedDate: row.planned_date,
      dueDate: row.due_date,
    }));
    const cycleEndDate = schedule.reduce<string | null>(
      (latest, row) => (!latest || row.dueDate > latest ? row.dueDate : latest),
      null,
    );
    return { rows: schedule, cycleEndDate };
  } catch {
    return { error: "Aperçu du calendrier impossible." };
  }
}

export async function instantiateCycle(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        cycle_template_id: id,
        cycle_name: z.string().trim().min(1).max(160),
        start_date: dateString,
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("instantiate_experimental_cycle", {
      p_template_id: values.cycle_template_id,
      p_cycle_name: values.cycle_name,
      p_start_date: values.start_date,
    });
    if (error)
      throw new Error(
        "Génération du cycle refusée (modèle archivé ou accès insuffisant).",
      );
    return actionSuccess("Cycle généré à partir du modèle.");
  } catch (error) {
    return actionError(error, "Impossible de générer ce cycle.");
  }
}

export async function updateTaskDetails(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        task_id: id,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500),
        assigned_to: optionalId,
        zone: z.string().trim().max(120),
        priority: z.enum(["low", "medium", "high", "critical"]),
        sop_code: z.string().trim().max(60),
        expected_deliverable: z.string().trim().max(500),
        notes: z.string().trim().max(2000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client
      .from("tasks")
      .update({
        title: values.title,
        description: values.description || null,
        assigned_to: values.assigned_to || null,
        zone: values.zone || null,
        priority: values.priority,
        sop_code: values.sop_code || null,
        expected_deliverable: values.expected_deliverable || null,
        notes: values.notes || null,
      })
      .eq("id", values.task_id);
    if (error) throw new Error("Modification de la tâche refusée.");
    return actionSuccess("Tâche mise à jour.");
  } catch (error) {
    return actionError(error, "Impossible de modifier cette tâche.");
  }
}

export async function rescheduleTask(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        task_id: id,
        planned_date: dateString,
        due_date: dateString,
      })
      .refine((v) => v.due_date >= v.planned_date, { path: ["due_date"] })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("recalculate_cycle_schedule", {
      p_task_id: values.task_id,
      p_new_planned_date: values.planned_date,
      p_new_due_date: values.due_date,
    });
    if (error) {
      // recalculate_cycle_schedule raises these exact French messages for
      // the cases the user needs to understand (dependency constraints,
      // a completed task that would have to move); show them verbatim.
      if (scheduleErrorMessages.some((m) => error.message.includes(m)))
        return actionError(error, error.message);
      throw new Error("Impossible de recalculer ce calendrier.");
    }
    return actionSuccess("Calendrier recalculé avec les dépendances.");
  } catch (error) {
    return actionError(error, "Impossible de recalculer ce calendrier.");
  }
}

export async function toggleChecklistItem(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = z
      .object({
        item_id: id,
        completed: z.union([z.literal("true"), z.literal("false")]),
        comment: z.string().trim().max(1000),
      })
      .parse(Object.fromEntries(form));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("complete_checklist_item", {
      target_item_id: values.item_id,
      new_completed: values.completed === "true",
      new_comment: values.comment || null,
    });
    if (error) throw new Error("Mise à jour du contrôle refusée.");
    return actionSuccess("Contrôle mis à jour.");
  } catch (error) {
    return actionError(error, "Impossible de mettre à jour ce contrôle.");
  }
}
