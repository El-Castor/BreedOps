import { Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import { formatDay } from "@/lib/breeding-entity-details";
import {
  TaskDrawer,
  type ChecklistRow,
  type DependencyLink,
  type TaskRow,
} from "./task-drawer";
import {
  buildHref,
  priorityLabels,
  taskStatusLabels,
  type OperationsParams,
} from "./filters";

const dayMs = 24 * 60 * 60 * 1000;
const scalePixelsPerDay = { week: 36, month: 12 } as const;
type Scale = keyof typeof scalePixelsPerDay;

function parseDay(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

export function GanttView({
  tasks,
  cycles,
  profiles,
  dependencies,
  checklistByTask,
  params,
  programId,
  today,
}: {
  tasks: TaskRow[];
  cycles: { id: string; name: string }[];
  profiles: { id: string; display_name: string | null; user_id: string }[];
  dependencies: DependencyLink[];
  checklistByTask: Record<string, ChecklistRow[]>;
  params: OperationsParams;
  programId: string;
  today: string;
}) {
  const scaleParam: Scale = params.scale === "month" ? "month" : "week";
  const dated = tasks.filter((t) => t.planned_date && t.due_date);
  if (!dated.length) {
    return (
      <div className="section-block">
        <SectionHeader
          title="Gantt"
          description="Chronologie des tâches dépendantes."
        />
        <Card>
          <EmptyState
            title="Aucune tâche planifiée"
            message="Ajoutez des dates à vos tâches pour afficher le diagramme de Gantt."
          />
        </Card>
      </div>
    );
  }
  const pixelsPerDay = scalePixelsPerDay[scaleParam];
  const rangeStartMs =
    Math.min(...dated.map((t) => parseDay(t.planned_date!))) - 2 * dayMs;
  const rangeEndMs =
    Math.max(...dated.map((t) => parseDay(t.due_date!))) + 2 * dayMs;
  const totalDays = Math.max(
    1,
    Math.round((rangeEndMs - rangeStartMs) / dayMs),
  );
  const chartWidth = totalDays * pixelsPerDay;
  const xFor = (value: string) =>
    ((parseDay(value) - rangeStartMs) / dayMs) * pixelsPerDay;
  const todayX = xFor(today);

  const cycleGroups = cycles
    .map((cycle) => ({
      cycle,
      rows: dated.filter((t) => t.experimental_cycle_id === cycle.id),
    }))
    .filter((group) => group.rows.length > 0);

  const profileName = (id: string | null) =>
    profiles.find((p) => p.id === id)?.display_name || "Non assigné";

  const rowIndex = new Map(dated.map((task, index) => [task.id, index]));
  const barTop = (taskId: string) => (rowIndex.get(taskId) ?? 0) * 40 + 20;

  const ticks: { x: number; label: string }[] = [];
  for (
    let offset = 0;
    offset <= totalDays;
    offset += scaleParam === "week" ? 7 : 30
  ) {
    const date = new Date(rangeStartMs + offset * dayMs);
    ticks.push({
      x: offset * pixelsPerDay,
      label: date.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      }),
    });
  }

  return (
    <div className="section-block">
      <SectionHeader
        title="Gantt"
        description="Chronologie dépendante des tâches, groupée par cycle. Cliquez un titre pour l’ouvrir."
        aside={
          <nav className="segmented" aria-label="Échelle du Gantt">
            <a
              className={scaleParam === "week" ? "active" : ""}
              href={buildHref(params, programId, {
                tab: "gantt",
                scale: "week",
              })}
            >
              Semaine
            </a>
            <a
              className={scaleParam === "month" ? "active" : ""}
              href={buildHref(params, programId, {
                tab: "gantt",
                scale: "month",
              })}
            >
              Mois
            </a>
          </nav>
        }
      />
      <Card className="flush">
        <div className="gantt" role="group" aria-label="Diagramme de Gantt">
          <div className="gantt-labels">
            <div className="gantt-labels-header">
              Tâche / Responsable / État
            </div>
            {cycleGroups.map((group) => (
              <div key={group.cycle.id}>
                <div className="gantt-cycle-heading">{group.cycle.name}</div>
                {group.rows.map((task) => {
                  const status = taskStatusLabels[task.status];
                  return (
                    <div className="gantt-label-row" key={task.id}>
                      <TaskDrawer
                        task={task}
                        cycleName={group.cycle.name}
                        profiles={profiles}
                        checklist={checklistByTask[task.id] ?? []}
                        dependencies={dependencies}
                        tasks={tasks}
                        today={today}
                      />
                      <span className="gantt-label-text">{task.title}</span>
                      <span className="gantt-label-meta">
                        {profileName(task.assigned_to)}
                        <StatusBadge tone={status?.tone ?? "neutral"}>
                          {status?.label ?? task.status}
                        </StatusBadge>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div
            className="gantt-scroll"
            tabIndex={0}
            aria-label="Zone de défilement du calendrier"
          >
            <div
              className="gantt-chart"
              style={{ width: chartWidth, position: "relative" }}
            >
              <div className="gantt-axis" style={{ height: 32 }}>
                {ticks.map((tick) => (
                  <span
                    key={tick.x}
                    className="gantt-tick"
                    style={{ left: tick.x }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
              {todayX >= 0 && todayX <= chartWidth && (
                <div
                  className="gantt-today"
                  style={{
                    left: todayX,
                    height:
                      cycleGroups.reduce((n, g) => n + g.rows.length, 0) * 40 +
                      40,
                  }}
                  aria-label="Aujourd’hui"
                  title="Aujourd’hui"
                />
              )}
              <svg
                className="gantt-dependencies"
                width={chartWidth}
                height={
                  cycleGroups.reduce((n, g) => n + g.rows.length, 0) * 40 + 40
                }
                aria-hidden="true"
              >
                {dependencies.map((link) => {
                  const pred = dated.find(
                    (t) => t.id === link.predecessor_task_id,
                  );
                  const succ = dated.find(
                    (t) => t.id === link.successor_task_id,
                  );
                  if (!pred || !succ) return null;
                  const x1 = xFor(pred.due_date!);
                  const y1 = barTop(pred.id) + 10;
                  const x2 = xFor(succ.planned_date!);
                  const y2 = barTop(succ.id) + 10;
                  const midX = (x1 + x2) / 2;
                  return (
                    <path
                      key={`${link.predecessor_task_id}-${link.successor_task_id}`}
                      d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                      className="gantt-dependency-path"
                    />
                  );
                })}
              </svg>
              {cycleGroups.map((group) => (
                <div key={group.cycle.id}>
                  <div className="gantt-row gantt-cycle-row" />
                  {group.rows.map((task) => {
                    const startX = xFor(task.planned_date!);
                    const endX = xFor(task.due_date!);
                    const overdue =
                      !task.completed_at &&
                      task.status !== "cancelled" &&
                      task.due_date! < today;
                    const predecessors = dependencies
                      .filter((d) => d.successor_task_id === task.id)
                      .map((d) =>
                        dated.find((t) => t.id === d.predecessor_task_id),
                      )
                      .filter((t): t is TaskRow => Boolean(t));
                    const accessibleName = [
                      task.title,
                      `du ${formatDay(task.planned_date)} au ${formatDay(task.due_date)}`,
                      profileName(task.assigned_to),
                      taskStatusLabels[task.status]?.label ?? task.status,
                      priorityLabels[task.priority] ?? task.priority,
                      overdue ? "en retard" : "",
                      predecessors.length
                        ? `dépend de ${predecessors.map((p) => p.title).join(", ")}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" — ");
                    return (
                      <div className="gantt-row" key={task.id}>
                        <div
                          className={`gantt-bar${overdue ? " overdue" : ""} status-${task.status}`}
                          style={{
                            left: startX,
                            width: Math.max(endX - startX, 4),
                          }}
                          title={accessibleName}
                          tabIndex={0}
                          role="img"
                          aria-label={accessibleName}
                        >
                          <span className="sr-only">{accessibleName}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <p className="inspector-note">
        Les dépendances sont aussi listées dans la fiche de chaque tâche (voir «
        Dépendances »).
      </p>
    </div>
  );
}
