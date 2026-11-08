import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon } from "@/components/icons";
import {
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { formatDay } from "@/lib/breeding-entity-details";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { createCycle, createTask, updateTaskStatus } from "./actions";
import {
  applyTaskFilters,
  buildHref,
  OperationsFilterBar,
  priorityLabels,
  resolveTab,
  tabs,
  taskStatusLabels,
  type OperationsParams,
} from "./filters";
import { GanttView } from "./gantt-view";
import {
  TaskDrawer,
  type ChecklistRow,
  type DependencyLink,
  type TaskRow,
} from "./task-drawer";
import { TemplatesView } from "./templates-view";

type Kpis = {
  crosses: number;
  seed_lots: number;
  mean_germination_rate: number | null;
  phenotypes_evaluated: number;
  elite_phenotypes: number;
  inventory_items_below_threshold: number;
  lots_nearing_expiration: number;
  overdue_tasks: number;
  task_completion_ratio: number;
};

export default async function Operations({
  searchParams,
}: {
  searchParams: Promise<OperationsParams>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
  const tab = resolveTab(params.tab);
  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger les programmes.",
  );
  if (programsState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={programsState.message}
          retryHref="/app/operations"
        />
      </div>
    );
  const programs = programsState.data;
  const program =
    programs?.find((item) => item.id === params.program) ?? programs?.[0];
  const programId = program?.id;
  const [
    cyclesResult,
    tasksResult,
    dependenciesResult,
    checklistResult,
    profilesResult,
    kpiResult,
  ] = programId
    ? await Promise.all([
        client
          .from("experimental_cycles")
          .select("id,name,start_date,end_date,status,source_template_id")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("start_date"),
        client
          .from("tasks")
          .select(
            "id,experimental_cycle_id,task_template_id,title,description,planned_date,due_date,assigned_to,priority,status,completed_at,zone,sop_code,expected_deliverable,notes",
          )
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("planned_date"),
        client
          .from("task_dependencies")
          .select("predecessor_task_id,successor_task_id,lag_days")
          .limit(2000),
        client
          .from("task_checklist_items")
          .select("id,task_id,label,is_required,is_completed,comment")
          .is("deleted_at", null)
          .order("sort_order"),
        client
          .from("profiles")
          .select("id,display_name,user_id")
          .eq("organization_id", team.id)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("display_name"),
        client.rpc("get_dashboard_kpis", { target_program_id: programId }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
      ];
  const cyclesState = collectionState(
    cyclesResult,
    "Impossible de charger les cycles.",
  );
  const tasksState = collectionState(
    tasksResult,
    "Impossible de charger les tâches.",
  );
  const profilesState = collectionState(
    profilesResult,
    "Impossible de charger les responsables.",
  );
  const failed = [cyclesState, tasksState, profilesState].find(
    (state) => state.status === "error",
  );
  if (failed?.status === "error" || kpiResult.error)
    return (
      <div className="page">
        <ErrorState
          message={
            failed?.status === "error"
              ? failed.message
              : "Impossible de charger les indicateurs."
          }
          retryHref={
            programId
              ? `/app/operations?program=${programId}`
              : "/app/operations"
          }
        />
      </div>
    );
  const cycles = cyclesState.data;
  const allTasks = tasksState.data as unknown as TaskRow[];
  const profiles = profilesState.data;
  const dependencies = (dependenciesResult.data ?? []) as DependencyLink[];
  const checklistItems = (checklistResult.data ?? []) as ChecklistRow[];
  const checklistByTask = checklistItems.reduce<Record<string, ChecklistRow[]>>(
    (acc, item) => {
      (acc[item.task_id] ??= []).push(item);
      return acc;
    },
    {},
  );
  const kpis = (kpiResult.data ?? {}) as Kpis;
  const tasks = applyTaskFilters(allTasks, params);
  const zones = [
    ...new Set(
      allTasks.map((t) => t.zone).filter((z): z is string => Boolean(z)),
    ),
  ].sort();
  const profileName = (id: string | null) =>
    profiles.find((p) => p.id === id)?.display_name || "Non assigné";
  const cycleName = (id: string) =>
    cycles.find((c) => c.id === id)?.name ?? "—";
  const today = new Date().toISOString().slice(0, 10);

  const metrics: [string, string | number, boolean][] = [
    ["Croisements", kpis.crosses, false],
    ["Lots de graines", kpis.seed_lots, false],
    [
      "Germination moyenne",
      kpis.mean_germination_rate == null
        ? "—"
        : `${kpis.mean_germination_rate} %`,
      false,
    ],
    ["Phénotypes évalués", kpis.phenotypes_evaluated, false],
    ["Phénotypes Elite", kpis.elite_phenotypes, false],
    [
      "Articles sous seuil",
      kpis.inventory_items_below_threshold,
      kpis.inventory_items_below_threshold > 0,
    ],
    [
      "Lots bientôt périmés",
      kpis.lots_nearing_expiration,
      kpis.lots_nearing_expiration > 0,
    ],
    ["Tâches en retard", kpis.overdue_tasks, kpis.overdue_tasks > 0],
    ["Tâches terminées", `${kpis.task_completion_ratio ?? 0} %`, false],
  ];

  const activeCycles = cycles.filter((c) => c.status === "active").length;
  const blockedTasks = allTasks.filter((t) => t.status === "blocked").length;
  const toDoTasks = allTasks.filter((t) => t.status === "not_started").length;
  const inProgressTasks = allTasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const upcomingTasks = allTasks
    .filter(
      (t) =>
        t.planned_date &&
        t.planned_date >= today &&
        t.status !== "completed" &&
        t.status !== "cancelled",
    )
    .sort((a, b) => (a.planned_date! < b.planned_date! ? -1 : 1))
    .slice(0, 8);

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Opérations" }]}
      />
      <PageHeader
        eyebrow="Planification"
        title="Opérations et indicateurs"
        description="Cycles expérimentaux, tâches assignées et indicateurs réels du programme."
        actions={
          program ? (
            <>
              <FormDrawer
                label="Nouveau cycle"
                title="Nouveau cycle expérimental"
                description="Un cycle regroupe les tâches planifiées."
                icon="calendar"
                variant="secondary"
                disabled={!program}
              >
                <ActionForm
                  action={createCycle}
                  className="form"
                  actionName="cycle"
                  submitLabel="Créer le cycle"
                >
                  <h3>Nouveau cycle</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <label>
                    Nom
                    <input name="name" required maxLength={160} />
                  </label>
                  <div className="fields-2">
                    <label>
                      Début
                      <input name="start_date" type="date" required />
                    </label>
                    <label>
                      Fin
                      <input name="end_date" type="date" required />
                    </label>
                  </div>
                </ActionForm>
              </FormDrawer>
              <FormDrawer
                label="Nouvelle tâche"
                title="Nouvelle tâche"
                description="Assignez une tâche datée à un cycle. Les workflows expérimentaux (onglet Modèles) génèrent automatiquement des tâches liées."
                icon="add"
                disabled={!program || !cycles.length}
                disabledReason="Créez d’abord un cycle expérimental"
              >
                <ActionForm
                  action={createTask}
                  className="form"
                  actionName="task"
                  submitLabel="Créer la tâche"
                  disabled={!cycles.length}
                >
                  <h3>Nouvelle tâche</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <div className="fields-2">
                    <label>
                      Cycle
                      <select name="experimental_cycle_id" required>
                        <option value="">Choisir</option>
                        {cycles.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Titre
                      <input name="title" required maxLength={200} />
                    </label>
                  </div>
                  <label>
                    Description
                    <input name="description" maxLength={500} />
                  </label>
                  <div className="fields-3">
                    <label>
                      Planifiée
                      <input name="planned_date" type="date" required />
                    </label>
                    <label>
                      Échéance
                      <input name="due_date" type="date" required />
                    </label>
                    <label>
                      Priorité
                      <select name="priority">
                        <option value="medium">Moyenne</option>
                        <option value="low">Basse</option>
                        <option value="high">Haute</option>
                        <option value="critical">Critique</option>
                      </select>
                    </label>
                  </div>
                  <div className="fields-2">
                    <label>
                      Responsable
                      <select name="assigned_to">
                        <option value="">Non assigné</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.display_name || p.user_id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Zone
                      <input name="zone" maxLength={120} />
                    </label>
                  </div>
                  {!cycles.length && (
                    <p className="form-hint blocked">
                      Créez d’abord un cycle expérimental.
                    </p>
                  )}
                </ActionForm>
              </FormDrawer>
            </>
          ) : undefined
        }
      />
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs ?? []}
        activeId={programId}
        basePath="/app/operations"
      />
      {!program ? (
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant de planifier les opérations."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      ) : (
        <>
          <nav className="tabs" aria-label="Sections des opérations">
            {tabs.map(([key, label, icon]) => (
              <a
                key={key}
                href={buildHref(params, programId, { tab: key })}
                aria-current={tab === key ? "page" : undefined}
              >
                <Icon name={icon} />
                {label}
              </a>
            ))}
          </nav>

          {tab === "overview" && (
            <>
              <section className="metrics-grid" aria-label="Indicateurs">
                {metrics.map(([label, value, attention]) => (
                  <MetricCard
                    key={label}
                    label={label}
                    value={String(value)}
                    attention={attention}
                  />
                ))}
              </section>
              <section className="section-block">
                <SectionHeader
                  title="État opérationnel"
                  description="Synthèse réelle des cycles et tâches de ce programme."
                />
                <section
                  className="metrics-grid"
                  aria-label="Synthèse opérationnelle"
                >
                  <MetricCard label="Cycles actifs" value={activeCycles} />
                  <MetricCard label="Tâches à faire" value={toDoTasks} />
                  <MetricCard label="Tâches en cours" value={inProgressTasks} />
                  <MetricCard
                    label="Tâches bloquées"
                    value={blockedTasks}
                    attention={blockedTasks > 0}
                  />
                  <MetricCard
                    label="Tâches en retard"
                    value={kpis.overdue_tasks ?? 0}
                    attention={(kpis.overdue_tasks ?? 0) > 0}
                  />
                  <MetricCard
                    label="Taux de complétion"
                    value={`${kpis.task_completion_ratio ?? 0} %`}
                  />
                </section>
                <Card className="flush">
                  {!upcomingTasks.length ? (
                    <EmptyState
                      title="Aucune échéance à venir"
                      message="Toutes les tâches planifiées sont passées ou terminées."
                    />
                  ) : (
                    <DataTable label="Prochaines échéances">
                      <table>
                        <thead>
                          <tr>
                            <th>Tâche</th>
                            <th>Cycle</th>
                            <th>Responsable</th>
                            <th>Échéance</th>
                            <th>État</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upcomingTasks.map((task) => {
                            const status = taskStatusLabels[task.status];
                            return (
                              <tr key={task.id}>
                                <td>{task.title}</td>
                                <td>{cycleName(task.experimental_cycle_id)}</td>
                                <td>{profileName(task.assigned_to)}</td>
                                <td className="num">
                                  {formatDay(task.planned_date)}
                                </td>
                                <td>
                                  <StatusBadge tone={status?.tone ?? "neutral"}>
                                    {status?.label ?? task.status}
                                  </StatusBadge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </DataTable>
                  )}
                </Card>
              </section>
            </>
          )}

          {(tab === "tasks" || tab === "calendar" || tab === "gantt") && (
            <OperationsFilterBar
              params={params}
              programId={programId}
              tab={tab}
              cycles={cycles}
              zones={zones}
              assignees={profiles}
            />
          )}

          {tab === "tasks" && (
            <section className="section-block">
              <SectionHeader
                title="Tâches"
                description={`${tasks.length} tâche${tasks.length > 1 ? "s" : ""} pour ce programme.`}
              />
              <Card className="flush">
                {!tasks.length ? (
                  <EmptyState
                    title="Aucune tâche"
                    message="Créez un cycle, puis ajoutez sa première tâche, ou instanciez un modèle de workflow."
                  />
                ) : (
                  <DataTable label="Tâches">
                    <table>
                      <thead>
                        <tr>
                          <th>Tâche</th>
                          <th>Cycle</th>
                          <th>Responsable</th>
                          <th>Période</th>
                          <th>Priorité</th>
                          <th>État</th>
                          <th>Retard</th>
                          <th>Ouvrir</th>
                          <th>Mettre à jour</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => {
                          const overdue =
                            !task.completed_at &&
                            task.status !== "cancelled" &&
                            task.due_date &&
                            task.due_date < today;
                          const status = taskStatusLabels[task.status];
                          return (
                            <tr key={task.id}>
                              <td>
                                <strong>{task.title}</strong>
                              </td>
                              <td>{cycleName(task.experimental_cycle_id)}</td>
                              <td>{profileName(task.assigned_to)}</td>
                              <td className="num">
                                {formatDay(task.planned_date)} →{" "}
                                {formatDay(task.due_date)}
                              </td>
                              <td>
                                <StatusBadge
                                  tone={
                                    task.priority === "critical" ||
                                    task.priority === "high"
                                      ? "warning"
                                      : "neutral"
                                  }
                                >
                                  {priorityLabels[task.priority] ??
                                    task.priority}
                                </StatusBadge>
                              </td>
                              <td>
                                <StatusBadge tone={status?.tone ?? "neutral"}>
                                  {status?.label ?? task.status}
                                </StatusBadge>
                              </td>
                              <td>
                                {overdue ? (
                                  <StatusBadge tone="danger">
                                    En retard
                                  </StatusBadge>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="cell-actions">
                                <TaskDrawer
                                  task={task}
                                  cycleName={cycleName(
                                    task.experimental_cycle_id,
                                  )}
                                  profiles={profiles}
                                  checklist={checklistByTask[task.id] ?? []}
                                  dependencies={dependencies}
                                  tasks={allTasks}
                                  today={today}
                                />
                              </td>
                              <td>
                                <ActionForm
                                  action={updateTaskStatus}
                                  actionName={`task-status-${task.id}`}
                                  className="inline-action"
                                  submitLabel="Appliquer"
                                >
                                  <input
                                    type="hidden"
                                    name="task_id"
                                    value={task.id}
                                  />
                                  <label
                                    className="sr-only"
                                    htmlFor={`status-${task.id}`}
                                  >
                                    État de {task.title}
                                  </label>
                                  <select
                                    id={`status-${task.id}`}
                                    name="status"
                                    defaultValue={task.status}
                                  >
                                    <option value="not_started">À faire</option>
                                    <option value="in_progress">
                                      En cours
                                    </option>
                                    <option value="blocked">Bloquée</option>
                                    <option value="completed">Terminée</option>
                                    <option value="cancelled">Annulée</option>
                                  </select>
                                </ActionForm>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </DataTable>
                )}
              </Card>
            </section>
          )}

          {tab === "calendar" && (
            <section className="section-block">
              <SectionHeader
                title="Calendrier"
                description={`${tasks.length} tâche${tasks.length > 1 ? "s" : ""} pour ce programme.`}
              />
              <Card>
                {!tasks.length ? (
                  <EmptyState
                    title="Aucune tâche"
                    message="Créez un cycle, puis ajoutez sa première tâche."
                  />
                ) : (
                  <div className="calendar-list">
                    {tasks.map((task) => (
                      <article className="metric" key={task.id}>
                        <small>
                          {formatDay(task.planned_date)} →{" "}
                          {formatDay(task.due_date)}
                        </small>
                        <strong>{task.title}</strong>
                        <span>
                          {priorityLabels[task.priority] ?? task.priority} ·{" "}
                          {taskStatusLabels[task.status]?.label ?? task.status}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </Card>
            </section>
          )}

          {tab === "gantt" && (
            <GanttView
              tasks={tasks}
              cycles={cycles}
              profiles={profiles}
              dependencies={dependencies}
              checklistByTask={checklistByTask}
              params={params}
              programId={programId!}
              today={today}
            />
          )}

          {tab === "templates" && programId && (
            <TemplatesView
              client={client}
              programId={programId}
              params={params}
              profiles={profiles}
            />
          )}
        </>
      )}
    </div>
  );
}
