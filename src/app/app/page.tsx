import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DistributionChart } from "@/components/charts";
import { Icon, type IconName } from "@/components/icons";
import {
  Breadcrumbs,
  Card,
  DecisionBadge,
  EmptyState,
  ErrorState,
  KindBadge,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { formatDay } from "@/lib/breeding-entity-details";
import { collectionState } from "@/lib/query-state";
import { createProgram } from "./breeding-actions";

type Row = { id: string; created_at: string };

const decisionOrder = ["elite", "advance", "reserve", "eliminate"] as const;
const decisionColors: Record<string, string> = {
  elite: "var(--chart-2)",
  advance: "var(--chart-1)",
  reserve: "var(--chart-3)",
  eliminate: "var(--chart-4)",
};
const taskLabels: Record<string, string> = {
  not_started: "À faire",
  in_progress: "En cours",
  blocked: "Bloquées",
  completed: "Terminées",
  cancelled: "Annulées",
};
const alertLabels: Record<string, string> = {
  expired: "Périmé",
  urgent: "Péremption < 30 j",
  plan: "Péremption < 90 j",
  order: "Sous le seuil",
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; campaign?: string }>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger vos programmes.",
  );
  if (programsState.status === "error")
    return (
      <div className="page">
        <ErrorState message={programsState.message} retryHref="/app" />
      </div>
    );
  const programs = programsState.data;
  // programs.campaign is a real, durable field (PROMPT.md §5.1) — grouping
  // by it is the only temporal/program grouping this data model actually
  // supports; there is no separate campaign table to invent one from.
  const campaigns = [
    ...new Set(
      programs
        .map((item) => item.campaign)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const explicitProgram = programs.find((item) => item.id === params.program);
  const selectedCampaign =
    !explicitProgram && params.campaign && campaigns.includes(params.campaign)
      ? params.campaign
      : undefined;
  // Picking one program (explicitProgram) always wins and narrows to just
  // that program; picking a campaign with no specific program aggregates
  // every program sharing it, so every KPI/chart below reflects the same
  // scope consistently. No campaign and no program falls back to the first
  // program, exactly like before this filter existed.
  const effectivePrograms = explicitProgram
    ? [explicitProgram]
    : selectedCampaign
      ? programs.filter((item) => item.campaign === selectedCampaign)
      : programs[0]
        ? [programs[0]]
        : [];
  const program = effectivePrograms[0];
  const programId = program?.id;
  const programIds = effectivePrograms.map((item) => item.id);
  const empty = { data: [], error: null };
  const results = programIds.length
    ? await Promise.all([
        client
          .from("parent_lines")
          .select("id,parent_code,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("crosses")
          .select("id,cross_code,status,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("families")
          .select("id,family_code,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("seed_lots")
          .select("id,seed_lot_code,status,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("phenotypes")
          .select("id,phenotype_code,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("tasks")
          .select("id,title,status,due_date,completed_at,created_at")
          .in("program_id", programIds)
          .is("deleted_at", null)
          .order("due_date", { ascending: true }),
        // security_invoker view: RLS limits alerts to the caller's team.
        // Inventory is organization-scoped, not program-scoped, so it is
        // deliberately not filtered by programIds — same as before.
        client
          .from("inventory_lot_status")
          .select("inventory_lot_id,alert_level,days_before_expiration")
          .not("alert_level", "is", null),
        client
          .from("experimental_cycles")
          .select("id,status")
          .in("program_id", programIds)
          .is("deleted_at", null),
      ])
    : [empty, empty, empty, empty, empty, empty, empty, empty];
  const states = [
    collectionState(results[0], "Impossible de charger les parents."),
    collectionState(results[1], "Impossible de charger les croisements."),
    collectionState(results[2], "Impossible de charger les familles."),
    collectionState(results[3], "Impossible de charger les lots."),
    collectionState(results[4], "Impossible de charger les phénotypes."),
    collectionState(results[5], "Impossible de charger les tâches."),
    collectionState(results[6], "Impossible de charger les alertes de stock."),
    collectionState(results[7], "Impossible de charger les cycles."),
  ];
  const failed = states.find((state) => state.status === "error");
  if (failed?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={failed.message}
          retryHref={programId ? `/app?program=${programId}` : "/app"}
        />
      </div>
    );
  const parents = states[0].data as (Row & { parent_code: string })[];
  const crosses = states[1].data as (Row & {
    cross_code: string;
    status: string;
  })[];
  const families = states[2].data as (Row & { family_code: string })[];
  const lots = states[3].data as (Row & {
    seed_lot_code: string;
    status: string;
  })[];
  const phenotypes = states[4].data as (Row & { phenotype_code: string })[];
  const tasks = states[5].data as (Row & {
    title: string;
    status: string;
    due_date: string | null;
    completed_at: string | null;
  })[];
  const alertRows = states[6].data as {
    inventory_lot_id: string;
    alert_level: string;
    days_before_expiration: number | null;
  }[];
  const cycles = states[7].data as { id: string; status: string }[];
  const activeCycles = cycles.filter(
    (cycle) => cycle.status === "active",
  ).length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const alertLotsResult = alertRows.length
    ? await client
        .from("inventory_lots")
        .select("id,batch_number")
        .in(
          "id",
          alertRows.map((row) => row.inventory_lot_id),
        )
    : { data: [], error: null };
  const inventoryAlerts = alertRows.map((row) => ({
    ...row,
    batch_number:
      (alertLotsResult.data ?? []).find(
        (lot: { id: string }) => lot.id === row.inventory_lot_id,
      )?.batch_number ?? "Lot",
  }));
  // Organization-scoped, same as the alerts above — never filtered by programIds.
  const coverageResult = await client
    .from("inventory_item_coverage")
    .select("inventory_item_id,low_coverage,has_sufficient_data");
  const stockCoverage = (coverageResult.data ?? []) as {
    low_coverage: boolean;
    has_sufficient_data: boolean;
  }[];
  const lowCoverageCount = stockCoverage.filter(
    (item) => item.low_coverage,
  ).length;
  // Germination and evaluations come from their own tables, never inferred.
  const [testsResult, evaluationsResult] = await Promise.all([
    lots.length
      ? client
          .from("germination_tests")
          .select("seed_lot_id,germination_rate,test_date")
          .in(
            "seed_lot_id",
            lots.map((lot) => lot.id),
          )
          .is("deleted_at", null)
          .order("test_date", { ascending: false })
      : Promise.resolve(empty),
    phenotypes.length
      ? client
          .from("phenotype_evaluations")
          .select(
            "id,phenotype_id,automatic_decision,is_eliminated,normalized_score,evaluation_date",
          )
          .in(
            "phenotype_id",
            phenotypes.map((item) => item.id),
          )
          .is("deleted_at", null)
          .order("normalized_score", { ascending: false, nullsFirst: false })
      : Promise.resolve(empty),
  ]);
  const testsState = collectionState(
    testsResult,
    "Impossible de charger la germination.",
  );
  const evaluationsState = collectionState(
    evaluationsResult,
    "Impossible de charger les évaluations.",
  );
  const dependent = [testsState, evaluationsState].find(
    (state) => state.status === "error",
  );
  if (dependent?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={dependent.message}
          retryHref={programId ? `/app?program=${programId}` : "/app"}
        />
      </div>
    );
  const tests = testsState.data as {
    seed_lot_id: string;
    germination_rate: number;
    test_date: string | null;
  }[];
  const evaluations = evaluationsState.data as {
    id: string;
    phenotype_id: string;
    automatic_decision: string | null;
    is_eliminated: boolean;
    normalized_score: number | null;
    evaluation_date: string | null;
  }[];

  const base = programId ? `?program=${programId}` : "";
  const evaluationHref = programId
    ? `/app/phenotypes?program=${programId}&tab=evaluations`
    : "/app/phenotypes?tab=evaluations";
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  );
  const overdue = openTasks.filter(
    (task) => task.due_date && task.due_date < today,
  );
  const upcoming = openTasks
    .filter((task) => !task.due_date || task.due_date >= today)
    .slice(0, 5);
  const latestRateByLot = new Map<string, number>();
  for (const test of tests)
    if (!latestRateByLot.has(test.seed_lot_id))
      latestRateByLot.set(test.seed_lot_id, Number(test.germination_rate));
  const meanGermination = latestRateByLot.size
    ? [...latestRateByLot.values()].reduce((sum, rate) => sum + rate, 0) /
      latestRateByLot.size
    : null;
  const scored = evaluations.filter((item) => item.automatic_decision);
  const decisionCounts = decisionOrder.map((decision) => ({
    decision,
    count: scored.filter((item) => item.automatic_decision === decision).length,
  }));
  const phenotypeCode = (id: string) =>
    phenotypes.find((item) => item.id === id)?.phenotype_code ?? "—";
  const taskStatusCounts = Object.keys(taskLabels)
    .map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }))
    .filter((item) => item.count);

  const crossStatusChart = [
    { label: "Planifié", value: 0, tone: "info" },
    { label: "Actif", value: 0, tone: "teal" },
    { label: "Terminé", value: 0, tone: "botanical" },
    { label: "Annulé", value: 0, tone: "archived" },
  ].map((item, index) => ({
    ...item,
    value: crosses.filter(
      (cross) =>
        cross.status === ["planned", "active", "completed", "cancelled"][index],
    ).length,
  }));
  const seedLotStatusChart = [
    { label: "Disponible", value: 0, tone: "botanical" },
    { label: "En quarantaine", value: 0, tone: "warning" },
    { label: "Épuisé", value: 0, tone: "danger" },
  ].map((item, index) => ({
    ...item,
    value: lots.filter(
      (lot) => lot.status === ["available", "quarantined", "depleted"][index],
    ).length,
  }));
  const decisionChart = [
    { label: "Elite", value: 0, tone: "botanical" },
    { label: "Advance", value: 0, tone: "teal" },
    { label: "Reserve", value: 0, tone: "warning" },
    { label: "Eliminate", value: 0, tone: "danger" },
  ].map((item, index) => ({
    ...item,
    value: decisionCounts[index]?.count ?? 0,
  }));
  const eliminatedByGate = scored.filter((item) => item.is_eliminated).length;
  const scoreBuckets = [
    { label: "0–25", min: 0, max: 25 },
    { label: "25–50", min: 25, max: 50 },
    { label: "50–75", min: 50, max: 75 },
    { label: "75–100", min: 75, max: 101 },
  ];
  const scoreDistributionChart = scoreBuckets.map((bucket) => ({
    label: `${bucket.label} %`,
    value: scored.filter((item) => {
      const score = Number(item.normalized_score ?? -1);
      return score >= bucket.min && score < bucket.max;
    }).length,
    tone: "teal",
  }));
  const taskStatusChart = Object.entries(taskLabels).map(([status, label]) => ({
    label,
    value: tasks.filter((task) => task.status === status).length,
    tone:
      status === "completed"
        ? "botanical"
        : status === "blocked"
          ? "danger"
          : status === "in_progress"
            ? "info"
            : status === "cancelled"
              ? "archived"
              : undefined,
  }));
  const inventoryRiskChart = [
    {
      label: "Alertes péremption/seuil",
      value: inventoryAlerts.length,
      tone: "warning",
    },
    { label: "Couverture faible", value: lowCoverageCount, tone: "danger" },
  ];

  const workflow: {
    label: string;
    count: number;
    href: string;
    ready: boolean;
    icon: IconName;
  }[] = [
    {
      label: "Lignées",
      count: parents.length,
      href: `/app/breeding${base}#parents`,
      ready: true,
      icon: "parent",
    },
    {
      label: "Croisements",
      count: crosses.length,
      href: `/app/breeding${base}#crosses`,
      ready: parents.length >= 2,
      icon: "cross",
    },
    {
      label: "Familles",
      count: families.length,
      href: `/app/breeding${base}#families`,
      ready: crosses.length > 0,
      icon: "family",
    },
    {
      label: "Lots",
      count: lots.length,
      href: `/app/breeding${base}#lots`,
      ready: families.length > 0,
      icon: "lot",
    },
    {
      label: "Germination",
      count: latestRateByLot.size,
      href: `/app/breeding${base}#germination`,
      ready: lots.length > 0,
      icon: "seed",
    },
    {
      label: "Phénotypage",
      count: phenotypes.length,
      href: evaluationHref,
      ready: lots.length > 0,
      icon: "phenotype",
    },
  ];
  // Coverage of each step relative to the previous one, from real counts.
  const coverage = (index: number) => {
    const step = workflow[index];
    if (!step.count) return 0;
    if (index === 0) return 100;
    return Math.min(
      100,
      Math.round((step.count / Math.max(1, workflow[index - 1].count)) * 100),
    );
  };
  const recent = [
    ...parents.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.parent_code,
      kind: "parent" as const,
      date: item.created_at,
    })),
    ...crosses.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.cross_code,
      kind: "cross" as const,
      date: item.created_at,
    })),
    ...families.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.family_code,
      kind: "family" as const,
      date: item.created_at,
    })),
    ...lots.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.seed_lot_code,
      kind: "lot" as const,
      date: item.created_at,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const kpis: {
    label: string;
    value: string | number;
    icon: IconName;
    href: string;
    hint: string;
    attention?: boolean;
  }[] = [
    {
      label: "Lignées actives",
      value: parents.length,
      icon: "parent",
      href: `/app/breeding${base}#parents`,
      hint: `${crosses.length} croisement(s)`,
    },
    {
      label: "Lots de graines",
      value: lots.length,
      icon: "lot",
      href: `/app/breeding${base}#lots`,
      hint: `${families.length} famille(s)`,
    },
    {
      label: "Germination moyenne",
      value: meanGermination == null ? "—" : `${meanGermination.toFixed(1)} %`,
      icon: "seed",
      href: `/app/breeding${base}#germination`,
      hint: `${latestRateByLot.size} lot(s) testé(s)`,
    },
    {
      label: "Phénotypes évalués",
      value: new Set(evaluations.map((item) => item.phenotype_id)).size,
      icon: "phenotype",
      href: evaluationHref,
      hint: `${phenotypes.length} phénotype(s) enregistré(s)`,
    },
    {
      label: "Cycles actifs",
      value: activeCycles,
      icon: "operations",
      href: `/app/operations${base}`,
      hint: `${tasks.length} tâche(s) au total`,
    },
    {
      label: "Tâches ouvertes",
      value: openTasks.length,
      icon: "operations",
      href: programId
        ? `/app/operations?program=${programId}&tab=tasks`
        : "/app/operations?tab=tasks",
      hint: overdue.length
        ? `${overdue.length} en retard`
        : blockedTasks
          ? `${blockedTasks} bloquée(s)`
          : "Aucun retard",
      attention: overdue.length > 0 || blockedTasks > 0,
    },
  ];

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Accueil" }]} />
      <PageHeader
        eyebrow="Tableau de bord"
        title="Vue d’ensemble"
        description="Poste de pilotage du programme actif : progression, sélection, travaux à venir et alertes."
        actions={
          program ? (
            <Link className="button-link" href={`/app/breeding${base}`}>
              <Icon name="program" />
              Ouvrir les registres
            </Link>
          ) : undefined
        }
      />
      <ProgramContext team={team.name} program={program} />
      {program ? (
        <>
          {campaigns.length > 1 && (
            <div className="program-switch">
              <span>Campagne</span>
              <nav className="chip-nav" aria-label="Filtrer par campagne">
                <Link className={selectedCampaign ? "" : "active"} href="/app">
                  Toutes
                </Link>
                {campaigns.map((campaign) => (
                  <Link
                    key={campaign}
                    className={campaign === selectedCampaign ? "active" : ""}
                    href={`/app?campaign=${encodeURIComponent(campaign)}`}
                  >
                    {campaign}
                  </Link>
                ))}
              </nav>
            </div>
          )}
          <ProgramSwitch
            programs={
              selectedCampaign
                ? programs.filter((item) => item.campaign === selectedCampaign)
                : programs
            }
            activeId={programId}
            basePath="/app"
          />
          <section className="kpi-grid" aria-label="Indicateurs du programme">
            {kpis.map((kpi) => (
              <Link
                key={kpi.label}
                href={kpi.href}
                className={`kpi${kpi.attention ? " attention" : ""}`}
              >
                <span className="kpi-label">{kpi.label}</span>
                <span className="kpi-icon">
                  <Icon name={kpi.icon} size={18} />
                </span>
                <strong className="kpi-value">{kpi.value}</strong>
                <span className="kpi-hint">{kpi.hint}</span>
              </Link>
            ))}
          </section>

          <Card>
            <div className="register-header card-title-row">
              <h2>
                <Icon name="lineage" size={18} />
                Progression du workflow d’élevage
              </h2>
              <small>Barre : couverture par rapport à l’étape précédente</small>
            </div>
            <nav className="pipeline" aria-label="Workflow d’élevage">
              {workflow.map((step, index) => (
                <Link
                  key={step.label}
                  href={step.href}
                  className={`pipeline-step${!step.ready ? " locked" : step.count ? " done" : ""}`}
                >
                  <header>
                    <span>{step.label}</span>
                    <Icon name={step.count ? "check" : step.icon} size={15} />
                  </header>
                  <strong>{step.count}</strong>
                  <span className="pipeline-bar" aria-hidden="true">
                    <span style={{ width: `${coverage(index)}%` }} />
                  </span>
                  <small>
                    {!step.ready
                      ? "En attente"
                      : step.count
                        ? `${coverage(index)} % de couverture`
                        : "À commencer"}
                  </small>
                </Link>
              ))}
            </nav>
          </Card>

          <section className="dashboard-columns">
            <div className="grid-stack">
              <Card className="chart-card">
                <h2 className="icon-heading">
                  <Icon name="score" size={18} />
                  Décisions de sélection
                </h2>
                {scored.length ? (
                  <>
                    <div
                      className="stacked-bar"
                      role="img"
                      aria-label={decisionCounts
                        .map((item) => `${item.decision} ${item.count}`)
                        .join(", ")}
                    >
                      {decisionCounts
                        .filter((item) => item.count)
                        .map((item) => (
                          <span
                            key={item.decision}
                            style={{
                              flex: item.count,
                              background: decisionColors[item.decision],
                            }}
                          />
                        ))}
                    </div>
                    <div className="chart-legend">
                      {decisionCounts.map((item) => (
                        <span key={item.decision}>
                          <i
                            style={{
                              background: decisionColors[item.decision],
                            }}
                          />
                          <DecisionBadge decision={item.decision} />
                          <strong className="num">{item.count}</strong>
                        </span>
                      ))}
                    </div>
                    <ol className="task-list">
                      {scored.slice(0, 5).map((item, index) => (
                        <li key={item.id}>
                          <span className="num muted">#{index + 1}</span>
                          <strong className="code">
                            {phenotypeCode(item.phenotype_id)}
                          </strong>
                          <span className="num">{item.normalized_score} %</span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="inspector-note">
                    Aucune évaluation classée pour ce programme.
                  </p>
                )}
              </Card>
              <Card className="chart-card">
                <h2 className="icon-heading">
                  <Icon name="seed" size={18} />
                  Germination par lot
                </h2>
                {latestRateByLot.size ? (
                  <ul className="bar-list">
                    {[...latestRateByLot.entries()].map(([lotId, rate]) => (
                      <li key={lotId}>
                        <span className="code">
                          {lots.find((lot) => lot.id === lotId)?.seed_lot_code}
                        </span>
                        <span className="bar" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, rate)}%` }} />
                        </span>
                        <span className="value">{rate.toFixed(1)} %</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">
                    Aucun test de germination enregistré.
                  </p>
                )}
              </Card>
            </div>
            <div className="grid-stack">
              <Card>
                <h2 className="icon-heading">
                  <Icon name="warning" size={18} />
                  Alertes
                </h2>
                {overdue.length || inventoryAlerts.length ? (
                  <ul className="alert-list">
                    {overdue.map((task) => (
                      <li key={task.id}>
                        <Icon name="operations" />
                        <span>{task.title}</span>
                        <StatusBadge tone="danger">
                          Échéance {formatDay(task.due_date)}
                        </StatusBadge>
                      </li>
                    ))}
                    {inventoryAlerts.slice(0, 5).map((alert) => (
                      <li key={alert.inventory_lot_id}>
                        <Icon name="inventory" />
                        <span className="code">{alert.batch_number}</span>
                        <StatusBadge tone="warning">
                          {alertLabels[alert.alert_level] ?? alert.alert_level}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">Aucune alerte active.</p>
                )}
              </Card>
              <Card>
                <h2 className="icon-heading">
                  <Icon name="calendar" size={18} />
                  Travaux à venir
                </h2>
                {upcoming.length ? (
                  <ul className="task-list">
                    {upcoming.map((task) => (
                      <li key={task.id}>
                        <span className="num muted">
                          {formatDay(task.due_date)}
                        </span>
                        <span>{task.title}</span>
                        <StatusBadge>
                          {taskLabels[task.status] ?? task.status}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">Aucune tâche planifiée.</p>
                )}
                {taskStatusCounts.length > 0 && (
                  <div className="chart-legend">
                    {taskStatusCounts.map((item) => (
                      <span key={item.status}>
                        {taskLabels[item.status]}{" "}
                        <strong className="num">{item.count}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </Card>
              <Card>
                <h2 className="icon-heading">
                  <Icon name="activity" size={18} />
                  Activité récente
                </h2>
                {recent.length ? (
                  <ul className="activity-list">
                    {recent.map((item) => (
                      <li key={`${item.kind}-${item.id}`}>
                        <KindBadge kind={item.kind} />
                        <strong className="code">{item.label}</strong>
                        <time dateTime={item.date}>{formatDay(item.date)}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">
                    Les derniers enregistrements apparaîtront ici.
                  </p>
                )}
              </Card>
              <Card>
                <h2 className="icon-heading">
                  <Icon name="add" size={18} />
                  Actions rapides
                </h2>
                <div className="quick-actions">
                  <Link
                    className="button-link secondary"
                    href={`/app/breeding${base}#parents`}
                  >
                    <Icon name="parent" />
                    Ajouter un parent
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/breeding${base}#crosses`}
                  >
                    <Icon name="cross" />
                    Créer un croisement
                  </Link>
                  <Link className="button-link secondary" href={evaluationHref}>
                    <Icon name="evaluation" />
                    Noter un phénotype
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/operations${base}`}
                  >
                    <Icon name="calendar" />
                    Créer une tâche
                  </Link>
                </div>
              </Card>
            </div>
          </section>

          <section className="section-block" aria-label="Graphiques">
            <SectionHeader
              title="Graphiques"
              description="Données réelles du périmètre actif (programme ou campagne) ; aucune valeur n’est simulée."
            />
            <div className="charts-grid">
              <DistributionChart
                title="Croisements par statut"
                items={crossStatusChart}
                emptyMessage="Aucun croisement enregistré pour ce périmètre."
              />
              <DistributionChart
                title="Lots de graines par statut"
                description="Statut opérationnel (disponible/quarantaine/épuisé), indépendant de la pureté génétique."
                items={seedLotStatusChart}
                emptyMessage="Aucun lot de graines enregistré pour ce périmètre."
              />
              <DistributionChart
                title="Répartition des décisions de sélection"
                description={
                  eliminatedByGate > 0
                    ? `Dont ${eliminatedByGate} éliminé(s) par un critère éliminatoire, indépendamment du score.`
                    : undefined
                }
                items={decisionChart}
                emptyMessage="Aucune évaluation décidée pour ce périmètre."
              />
              <DistributionChart
                title="Distribution des scores normalisés"
                items={scoreDistributionChart}
                emptyMessage="Aucun score normalisé disponible pour ce périmètre."
              />
              <DistributionChart
                title="Tâches par statut"
                items={taskStatusChart}
                emptyMessage="Aucune tâche enregistrée pour ce périmètre."
              />
              <DistributionChart
                title="Risques d’inventaire"
                description="Inventaire du laboratoire — organisation entière, non limité au programme/campagne."
                items={inventoryRiskChart}
                emptyMessage="Aucune alerte de stock ni de couverture faible."
              />
            </div>
          </section>
        </>
      ) : (
        <Card>
          <EmptyState
            title="Commencez avec un programme"
            message="Un programme isole votre espèce, votre campagne et votre matériel végétal."
          />
          <ActionForm action={createProgram} actionName="program">
            <h2>Nouveau programme</h2>
            <div className="fields-2">
              <label>
                Code
                <input name="code" required maxLength={80} />
              </label>
              <label>
                Nom
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Espèce
                <input name="species" required maxLength={160} />
              </label>
              <label>
                Campagne
                <input name="campaign" maxLength={40} />
              </label>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
