import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  ProgramContext,
  StatusBadge,
} from "@/components/ui";
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
  const base = programId ? `?program=${programId}` : "";
  const workflow = [
    {
      label: "Parents",
      count: parents.length,
      href: `/app/breeding${base}#parents`,
      ready: true,
    },
    {
      label: "Croisements",
      count: crosses.length,
      href: `/app/breeding${base}#crosses`,
      ready: parents.length >= 2,
    },
    {
      label: "Familles",
      count: families.length,
      href: `/app/breeding${base}#families`,
      ready: crosses.length > 0,
    },
    {
      label: "Lots",
      count: lots.length,
      href: `/app/breeding${base}#lots`,
      ready: families.length > 0,
    },
    {
      label: "Germination",
      count: lots.length,
      href: `/app/breeding${base}#germination`,
      ready: lots.length > 0,
    },
  ];
  const recent = [
    ...parents
      .slice(0, 2)
      .map((item: { id: string; parent_code: string; created_at: string }) => ({
        id: item.id,
        label: item.parent_code,
        type: "Lignée",
        date: item.created_at,
      })),
    ...crosses
      .slice(0, 2)
      .map((item: { id: string; cross_code: string; created_at: string }) => ({
        id: item.id,
        label: item.cross_code,
        type: "Croisement",
        date: item.created_at,
      })),
    ...lots
      .slice(0, 2)
      .map(
        (item: { id: string; seed_lot_code: string; created_at: string }) => ({
          id: item.id,
          label: item.seed_lot_code,
          type: "Lot",
          date: item.created_at,
        }),
      ),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Accueil" }]} />
      <PageHeader
        eyebrow="Tableau de bord"
        title="Vue d’ensemble"
        description="Votre programme actif, ses prochaines étapes et les données récemment enregistrées."
      />
      <ProgramContext team={team.name} program={program} />
      {program ? (
        <>
          <Card className="program-picker">
            <div>
              <h2>Programme actif</h2>
              <p>Changez de programme sans mélanger les registres.</p>
            </div>
            <nav className="chip-nav" aria-label="Programmes">
              {programs.map((item) => (
                <Link
                  key={item.id}
                  className={item.id === programId ? "active" : ""}
                  href={`/app?program=${item.id}`}
                >
                  {item.code}
                </Link>
              ))}
            </nav>
          </Card>
          <section>
            <h2>Résumé rapide</h2>
            <div className="metrics-grid">
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
                label="Phénotypes"
                value={phenotypes.length}
                href={`/app/phenotypes${base}`}
              />
              <MetricCard
                label="Tâches"
                value={tasks.length}
                href={`/app/operations${base}`}
              />
            </div>
          </section>
          <section className="dashboard-grid">
            <Card>
              <h2>Workflow d’élevage</h2>
              <div className="workflow-list">
                {workflow.map((step, index) => (
                  <Link
                    href={step.href}
                    key={step.label}
                    className={!step.ready ? "locked" : ""}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <small>
                        {step.ready
                          ? `${step.count} enregistré${step.count > 1 ? "s" : ""}`
                          : "Prérequis à compléter"}
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
                        ? "Actif"
                        : step.ready
                          ? "À commencer"
                          : "En attente"}
                    </StatusBadge>
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <h2>Activité récente</h2>
              {recent.length ? (
                <ul className="activity-list">
                  {recent.map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      <StatusBadge>{item.type}</StatusBadge>
                      <strong>{item.label}</strong>
                      <time>
                        {new Intl.DateTimeFormat("fr-FR").format(
                          new Date(item.date),
                        )}
                      </time>
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
          </section>
          <section>
            <h2>Actions rapides</h2>
            <div className="quick-actions">
              <Link href={`/app/breeding${base}#parents`}>
                Ajouter un parent
              </Link>
              <Link href={`/app/breeding${base}#crosses`}>
                Créer un croisement
              </Link>
              <Link href={`/app/breeding${base}#lots`}>Enregistrer un lot</Link>
              <Link href={`/app/phenotypes${base}`}>Noter un phénotype</Link>
              <Link href={`/app/operations${base}`}>Créer une tâche</Link>
            </div>
          </section>
        </>
      ) : (
        <Card>
          <EmptyState
            title="Commencez avec un programme"
            message="Un programme isole votre espèce, campagne et matériel végétal."
          />
          <ActionForm action={createProgram} actionName="program">
            <h2>Nouveau programme</h2>
            <label>
              Code requis
              <input name="code" required maxLength={80} />
            </label>
            <label>
              Nom requis
              <input name="name" required maxLength={160} />
            </label>
            <label>
              Espèce requise
              <input name="species" required maxLength={160} />
            </label>
            <label>
              Campagne
              <input name="campaign" maxLength={40} />
            </label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
