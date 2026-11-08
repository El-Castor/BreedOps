import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ui";
import { formatDay } from "@/lib/breeding-entity-details";
import {
  priorityLabels,
  taskStatusLabels,
  type FilterableTask,
} from "./filters";
import {
  rescheduleTask,
  toggleChecklistItem,
  updateTaskDetails,
} from "./actions";

export type TaskRow = FilterableTask & {
  id: string;
  title: string;
  description: string | null;
  planned_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  sop_code: string | null;
  expected_deliverable: string | null;
  notes: string | null;
};

export type ChecklistRow = {
  id: string;
  task_id: string;
  label: string;
  is_required: boolean;
  is_completed: boolean;
  comment: string | null;
};

export type DependencyLink = {
  predecessor_task_id: string;
  successor_task_id: string;
  lag_days: number;
};

function linkedTask(taskId: string, tasks: TaskRow[]): TaskRow | undefined {
  return tasks.find((t) => t.id === taskId);
}

/** Derived readiness: not persisted, computed from the task's own status
 * and its predecessors' statuses (see docs/database.md). */
function readiness(
  task: TaskRow,
  predecessors: TaskRow[],
): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
} {
  if (task.status === "completed")
    return { label: "Terminée", tone: "success" };
  if (task.status === "cancelled") return { label: "Annulée", tone: "neutral" };
  const waiting = predecessors.some((p) => p.status !== "completed");
  if (waiting) return { label: "En attente d’une dépendance", tone: "warning" };
  return { label: "Prête", tone: "info" };
}

export function TaskDrawer({
  task,
  cycleName,
  profiles,
  checklist,
  dependencies,
  tasks,
  today,
}: {
  task: TaskRow;
  cycleName: string;
  profiles: { id: string; display_name: string | null; user_id: string }[];
  checklist: ChecklistRow[];
  dependencies: DependencyLink[];
  tasks: TaskRow[];
  today: string;
}) {
  const predecessors = dependencies
    .filter((d) => d.successor_task_id === task.id)
    .map((d) => ({ link: d, task: linkedTask(d.predecessor_task_id, tasks) }))
    .filter((row) => row.task);
  const successors = dependencies
    .filter((d) => d.predecessor_task_id === task.id)
    .map((d) => ({ link: d, task: linkedTask(d.successor_task_id, tasks) }))
    .filter((row) => row.task);
  const overdue =
    !task.completed_at &&
    task.status !== "cancelled" &&
    task.due_date != null &&
    task.due_date < today;
  const status = taskStatusLabels[task.status];
  const ready = readiness(
    task,
    predecessors.map((row) => row.task!),
  );

  return (
    <FormDrawer
      label="Ouvrir"
      title={task.title}
      description={`Cycle : ${cycleName}`}
      icon="inspect"
      variant="secondary"
    >
      <section className="task-drawer-summary">
        <StatusBadge tone={status?.tone ?? "neutral"}>
          {status?.label ?? task.status}
        </StatusBadge>
        <StatusBadge tone={ready.tone}>{ready.label}</StatusBadge>
        {overdue && <StatusBadge tone="danger">En retard</StatusBadge>}
      </section>

      {(predecessors.length > 0 || successors.length > 0) && (
        <section aria-label="Dépendances">
          <h3 className="icon-heading">
            <Icon name="dependency" size={14} />
            Dépendances
          </h3>
          {predecessors.length > 0 && (
            <div>
              <p className="inspector-note">Dépend de :</p>
              <ul className="dependency-list">
                {predecessors.map(({ link, task: pred }) => (
                  <li key={pred!.id}>
                    {pred!.title} — {taskStatusLabels[pred!.status]?.label}{" "}
                    (échéance {formatDay(pred!.due_date)}
                    {link.lag_days > 0 ? `, délai +${link.lag_days} j` : ""})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {successors.length > 0 && (
            <div>
              <p className="inspector-note">Nécessaire pour :</p>
              <ul className="dependency-list">
                {successors.map(({ task: succ }) => (
                  <li key={succ!.id}>{succ!.title}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {checklist.length > 0 && (
        <section aria-label="Contrôles SOP">
          <h3 className="icon-heading">
            <Icon name="check" size={14} />
            Contrôles
          </h3>
          <ul className="checklist">
            {checklist.map((item) => (
              <li key={item.id}>
                <ActionForm
                  action={toggleChecklistItem}
                  actionName={`checklist-${item.id}`}
                  className="checklist-inline-form"
                  submitLabel={item.is_completed ? "Rouvrir" : "Valider"}
                  resetOnSuccess={false}
                >
                  <input type="hidden" name="item_id" value={item.id} />
                  <input
                    type="hidden"
                    name="completed"
                    value={item.is_completed ? "false" : "true"}
                  />
                  <input
                    type="hidden"
                    name="comment"
                    value={item.comment ?? ""}
                  />
                  <span className={item.is_completed ? "checklist-done" : ""}>
                    {item.is_completed && <Icon name="check" size={14} />}
                    {item.label}
                    {item.is_required && (
                      <StatusBadge tone="warning">Obligatoire</StatusBadge>
                    )}
                  </span>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Planification">
        <h3 className="icon-heading">
          <Icon name="calendar" size={14} />
          Planification
        </h3>
        <ActionForm
          action={rescheduleTask}
          actionName={`task-reschedule-${task.id}`}
          submitLabel="Enregistrer et recalculer les dépendances"
          resetOnSuccess={false}
        >
          <input type="hidden" name="task_id" value={task.id} />
          <div className="fields-2">
            <label>
              Date planifiée
              <input
                type="date"
                name="planned_date"
                defaultValue={task.planned_date ?? ""}
                required
              />
            </label>
            <label>
              Échéance
              <input
                type="date"
                name="due_date"
                defaultValue={task.due_date ?? ""}
                required
              />
            </label>
          </div>
          {task.status === "completed" && (
            <p className="form-hint blocked">
              Cette tâche est terminée ; sa date ne peut plus être modifiée.
            </p>
          )}
        </ActionForm>
      </section>

      <section aria-label="Détails">
        <h3 className="icon-heading">
          <Icon name="edit" size={14} />
          Détails
        </h3>
        <ActionForm
          action={updateTaskDetails}
          actionName={`task-details-${task.id}`}
          submitLabel="Enregistrer"
          resetOnSuccess={false}
        >
          <input type="hidden" name="task_id" value={task.id} />
          <label>
            Titre
            <input
              name="title"
              defaultValue={task.title}
              required
              maxLength={200}
            />
          </label>
          <label>
            Description
            <input
              name="description"
              defaultValue={task.description ?? ""}
              maxLength={500}
            />
          </label>
          <div className="fields-2">
            <label>
              Responsable
              <select name="assigned_to" defaultValue={task.assigned_to ?? ""}>
                <option value="">Non assigné</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.display_name || profile.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zone
              <input
                name="zone"
                defaultValue={task.zone ?? ""}
                maxLength={120}
              />
            </label>
          </div>
          <div className="fields-2">
            <label>
              Priorité
              <select name="priority" defaultValue={task.priority}>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Code SOP
              <input
                name="sop_code"
                defaultValue={task.sop_code ?? ""}
                maxLength={60}
              />
            </label>
          </div>
          <label>
            Livrable attendu
            <input
              name="expected_deliverable"
              defaultValue={task.expected_deliverable ?? ""}
              maxLength={500}
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={task.notes ?? ""}
              maxLength={2000}
              rows={2}
            />
          </label>
        </ActionForm>
      </section>
    </FormDrawer>
  );
}
