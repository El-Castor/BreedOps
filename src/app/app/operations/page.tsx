import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
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

const taskStatus: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  not_started: { label: "À faire", tone: "neutral" },
  in_progress: { label: "En cours", tone: "info" },
  blocked: { label: "Bloquée", tone: "danger" },
  completed: { label: "Terminée", tone: "success" },
  cancelled: { label: "Annulée", tone: "neutral" },
};
const priorityLabels: Record<string, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
};
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { createCycle, createTask, updateTaskStatus } from "./actions";

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
  searchParams: Promise<{ program?: string; view?: string }>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
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
  const [cyclesResult, tasksResult, profilesResult, kpiResult] = programId
    ? await Promise.all([
        client
          .from("experimental_cycles")
          .select("id,name,start_date,end_date,status")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("start_date"),
        client
          .from("tasks")
          .select(
            "id,experimental_cycle_id,title,planned_date,due_date,assigned_to,priority,status,completed_at,zone",
          )
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("planned_date"),
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
  const cycles = cyclesState.data,
    tasks = tasksState.data,
    profiles = profilesState.data;
  const kpis = (kpiResult.data ?? {}) as Kpis;
  const profileName = (id: string | null) =>
    profiles.find((p) => p.id === id)?.display_name || "Non assigné";
  const cycleName = (id: string) =>
    cycles.find((c) => c.id === id)?.name ?? "—";
  const today = new Date().toISOString().slice(0, 10);
  const calendar = params.view === "calendar";
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
                description="Assignez une tâche datée à un cycle."
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
              title={calendar ? "Calendrier" : "Tâches"}
              description={`${tasks.length} tâche${tasks.length > 1 ? "s" : ""} pour ce programme.`}
              aside={
                <nav className="segmented" aria-label="Affichage des tâches">
                  <Link
                    className={calendar ? "" : "active"}
                    href={`/app/operations?program=${programId}`}
                  >
                    Liste
                  </Link>
                  <Link
                    className={calendar ? "active" : ""}
                    href={`/app/operations?program=${programId}&view=calendar`}
                  >
                    Calendrier
                  </Link>
                </nav>
              }
            />
            <Card className={calendar ? undefined : "flush"}>
              {!tasks.length ? (
                <EmptyState
                  title="Aucune tâche"
                  message="Créez un cycle, puis ajoutez sa première tâche."
                />
              ) : calendar ? (
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
                        {taskStatus[task.status]?.label ?? task.status}
                      </span>
                    </article>
                  ))}
                </div>
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
                        const status = taskStatus[task.status];
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
                                {priorityLabels[task.priority] ?? task.priority}
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
                                  <option value="in_progress">En cours</option>
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
        </>
      )}
    </div>
  );
}
