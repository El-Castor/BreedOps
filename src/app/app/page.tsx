import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  EmptyState,
  ErrorState,
  KindBadge,
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
import { createProgram } from "./breeding-actions";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
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
  const program =
    programs.find((item) => item.id === params.program) ?? programs[0];
  const programId = program?.id;
  const empty = { data: [], error: null };
  const results = programId
    ? await Promise.all([
        client
          .from("parent_lines")
          .select("id,parent_code,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("crosses")
          .select("id,cross_code,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("families")
          .select("id,family_code,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("seed_lots")
          .select("id,seed_lot_code,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("phenotypes")
          .select("id,phenotype_code,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        client
          .from("tasks")
          .select("id,title,status,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ])
    : [empty, empty, empty, empty, empty, empty];
  const states = [
    collectionState(results[0], "Impossible de charger les parents."),
    collectionState(results[1], "Impossible de charger les croisements."),
    collectionState(results[2], "Impossible de charger les familles."),
    collectionState(results[3], "Impossible de charger les lots."),
    collectionState(results[4], "Impossible de charger les phénotypes."),
    collectionState(results[5], "Impossible de charger les tâches."),
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
  const parents = states[0].data as {
    id: string;
    parent_code: string;
    created_at: string;
  }[];
  const crosses = states[1].data as {
    id: string;
    cross_code: string;
    created_at: string;
  }[];
  const families = states[2].data as {
    id: string;
    family_code: string;
    created_at: string;
  }[];
  const lots = states[3].data as {
    id: string;
    seed_lot_code: string;
    created_at: string;
  }[];
  const phenotypes = states[4].data as {
    id: string;
    phenotype_code: string;
    created_at: string;
  }[];
  const tasks = states[5].data as {
    id: string;
    title: string;
    status: string;
    created_at: string;
  }[];
  // Germination tests are counted from their own table, not inferred from lots.
  const germinationResult = lots.length
    ? await client
        .from("germination_tests")
        .select("id", { count: "exact", head: true })
        .in(
          "seed_lot_id",
          lots.map((lot) => lot.id),
        )
        .is("deleted_at", null)
    : { count: 0, error: null };
  if (germinationResult.error)
    return (
      <div className="page">
        <ErrorState
          message="Impossible de charger les tests de germination."
          retryHref={programId ? `/app?program=${programId}` : "/app"}
        />
      </div>
    );
  const germinationCount = germinationResult.count ?? 0;
  const base = programId ? `?program=${programId}` : "";
  const workflow = [
    {
      label: "Lignées parentales",
      count: parents.length,
      href: `/app/breeding${base}#parents`,
      ready: true,
      requirement: "",
    },
    {
      label: "Croisements",
      count: crosses.length,
      href: `/app/breeding${base}#crosses`,
      ready: parents.length >= 2,
      requirement: "Deux lignées actives nécessaires",
    },
    {
      label: "Familles",
      count: families.length,
      href: `/app/breeding${base}#families`,
      ready: crosses.length > 0,
      requirement: "Un croisement actif nécessaire",
    },
    {
      label: "Lots de graines",
      count: lots.length,
      href: `/app/breeding${base}#lots`,
      ready: families.length > 0,
      requirement: "Une famille active nécessaire",
    },
    {
      label: "Germination",
      count: germinationCount,
      href: `/app/breeding${base}#germination`,
      ready: lots.length > 0,
      requirement: "Un lot actif nécessaire",
    },
    {
      label: "Phénotypage",
      count: phenotypes.length,
      href: `/app/phenotypes${base}`,
      ready: lots.length > 0,
      requirement: "Une famille et un lot nécessaires",
    },
  ];
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
  const openTasks = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  ).length;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Accueil" }]} />
      <PageHeader
        eyebrow="Tableau de bord"
        title="Vue d’ensemble"
        description="État du programme actif, progression du workflow et derniers enregistrements."
        actions={
          program ? (
            <Link className="button-link" href={`/app/breeding${base}`}>
              Ouvrir les registres
            </Link>
          ) : undefined
        }
      />
      <ProgramContext team={team.name} program={program} />
      {program ? (
        <>
          <ProgramSwitch
            programs={programs}
            activeId={programId}
            basePath="/app"
          />
          <section
            className="metrics-grid"
            aria-label="Indicateurs du programme"
          >
            <MetricCard
              label="Parents"
              value={parents.length}
              href={`/app/breeding${base}#parents`}
            />
            <MetricCard
              label="Croisements"
              value={crosses.length}
              href={`/app/breeding${base}#crosses`}
            />
            <MetricCard
              label="Familles"
              value={families.length}
              href={`/app/breeding${base}#families`}
            />
            <MetricCard
              label="Lots de graines"
              value={lots.length}
              href={`/app/breeding${base}#lots`}
            />
            <MetricCard
              label="Tests de germination"
              value={germinationCount}
              href={`/app/breeding${base}#germination`}
            />
            <MetricCard
              label="Phénotypes"
              value={phenotypes.length}
              href={`/app/phenotypes${base}`}
            />
            <MetricCard
              label="Tâches ouvertes"
              value={openTasks}
              href={`/app/operations${base}`}
            />
          </section>
          <section className="dashboard-grid">
            <Card>
              <SectionHeader
                title="Workflow d’élevage"
                description="Chaque étape débloque la suivante."
              />
              <div className="workflow-list">
                {workflow.map((step, index) => (
                  <Link
                    href={step.href}
                    key={step.label}
                    className={
                      !step.ready ? "locked" : step.count ? "done" : ""
                    }
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <small>
                        {step.ready
                          ? `${step.count} enregistré${step.count > 1 ? "s" : ""}`
                          : step.requirement}
                      </small>
                    </div>
                    <StatusBadge
                      tone={
                        step.count
                          ? "success"
                          : step.ready
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {step.count
                        ? "En cours"
                        : step.ready
                          ? "À commencer"
                          : "En attente"}
                    </StatusBadge>
                  </Link>
                ))}
              </div>
            </Card>
            <div className="grid-stack">
              <Card>
                <SectionHeader title="Activité récente" />
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
                  <EmptyState
                    title="Aucune activité"
                    message="Les derniers enregistrements apparaîtront ici."
                  />
                )}
              </Card>
              <Card>
                <SectionHeader title="Actions rapides" />
                <div className="quick-actions">
                  <Link
                    className="button-link secondary"
                    href={`/app/breeding${base}#parents`}
                  >
                    Ajouter un parent
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/breeding${base}#crosses`}
                  >
                    Créer un croisement
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/breeding${base}#lots`}
                  >
                    Enregistrer un lot
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/phenotypes${base}`}
                  >
                    Noter un phénotype
                  </Link>
                  <Link
                    className="button-link secondary"
                    href={`/app/operations${base}`}
                  >
                    Créer une tâche
                  </Link>
                </div>
              </Card>
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
