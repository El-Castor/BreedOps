import { Icon, type IconName } from "@/components/icons";

export type Tab = "overview" | "tasks" | "calendar" | "gantt" | "templates";

export const tabs: [Tab, string, IconName][] = [
  ["overview", "Vue d’ensemble", "overview"],
  ["tasks", "Tâches", "tasks"],
  ["calendar", "Calendrier", "calendar"],
  ["gantt", "Gantt", "gantt"],
  ["templates", "Modèles", "library"],
];

export type OperationsParams = {
  program?: string;
  tab?: string;
  cycle?: string;
  zone?: string;
  assignee?: string;
  status?: string;
  priority?: string;
  template?: string;
  start?: string;
  scale?: string;
};

export function resolveTab(value: string | undefined): Tab {
  return tabs.some(([key]) => key === value) ? (value as Tab) : "overview";
}

/** Every cross-view filter is carried in the URL so switching tabs, or
 * reloading, never silently drops what the user picked. */
export function buildHref(
  params: OperationsParams,
  programId: string | undefined,
  overrides: Partial<OperationsParams>,
) {
  const merged: OperationsParams = {
    ...params,
    program: programId,
    ...overrides,
  };
  const query = new URLSearchParams();
  if (merged.program) query.set("program", merged.program);
  if (merged.tab && merged.tab !== "overview") query.set("tab", merged.tab);
  if (merged.cycle) query.set("cycle", merged.cycle);
  if (merged.zone) query.set("zone", merged.zone);
  if (merged.assignee) query.set("assignee", merged.assignee);
  if (merged.status) query.set("status", merged.status);
  if (merged.priority) query.set("priority", merged.priority);
  if (merged.template) query.set("template", merged.template);
  if (merged.scale) query.set("scale", merged.scale);
  const qs = query.toString();
  return `/app/operations${qs ? `?${qs}` : ""}`;
}

export type FilterableTask = {
  experimental_cycle_id: string;
  zone: string | null;
  assigned_to: string | null;
  status: string;
  priority: string;
};

export function applyTaskFilters<T extends FilterableTask>(
  tasks: T[],
  params: OperationsParams,
): T[] {
  return tasks.filter((task) => {
    if (params.cycle && task.experimental_cycle_id !== params.cycle)
      return false;
    if (params.zone && task.zone !== params.zone) return false;
    if (params.assignee && task.assigned_to !== params.assignee) return false;
    if (params.status && task.status !== params.status) return false;
    if (params.priority && task.priority !== params.priority) return false;
    return true;
  });
}

export const priorityLabels: Record<string, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
};

export const taskStatusLabels: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  not_started: { label: "À faire", tone: "neutral" },
  in_progress: { label: "En cours", tone: "info" },
  blocked: { label: "Bloquée", tone: "danger" },
  completed: { label: "Terminée", tone: "success" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

/** Shared cross-view filter bar (Program is handled by ProgramSwitch above
 * it; this covers Cycle/Zone/Responsible/Status/Priority) backing
 * Tâches/Calendrier/Gantt alike, so filter logic is never duplicated per
 * view. A plain GET form keeps it working before hydration. */
export function OperationsFilterBar({
  params,
  programId,
  tab,
  cycles,
  zones,
  assignees,
}: {
  params: OperationsParams;
  programId: string | undefined;
  tab: Tab;
  cycles: { id: string; name: string }[];
  zones: string[];
  assignees: { id: string; display_name: string | null; user_id: string }[];
}) {
  return (
    <form method="get" className="operations-filters" role="search">
      {programId && <input type="hidden" name="program" value={programId} />}
      {tab !== "overview" && <input type="hidden" name="tab" value={tab} />}
      <label>
        <span className="sr-only">Cycle</span>
        <select name="cycle" defaultValue={params.cycle ?? ""}>
          <option value="">Tous les cycles</option>
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Zone</span>
        <select name="zone" defaultValue={params.zone ?? ""}>
          <option value="">Toutes les zones</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Responsable</span>
        <select name="assignee" defaultValue={params.assignee ?? ""}>
          <option value="">Tous les responsables</option>
          {assignees.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.display_name || profile.user_id}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">État</span>
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">Tous les états</option>
          {Object.entries(taskStatusLabels).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Priorité</span>
        <select name="priority" defaultValue={params.priority ?? ""}>
          <option value="">Toutes les priorités</option>
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary">
        <Icon name="filter" />
        Filtrer
      </button>
    </form>
  );
}
