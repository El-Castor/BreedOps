import {
  Breadcrumbs,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { FieldPackCard } from "./field-pack-card";
import { listTrials } from "../trials/actions";

export default async function FieldPacks({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const { client, profile, team } = await requireIdentity();
  const params = await searchParams;

  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger les programmes.",
  );

  const breadcrumbs = (
    <Breadcrumbs
      items={[{ label: "Accueil", href: "/app" }, { label: "Terrain" }]}
    />
  );
  const header = (
    <PageHeader
      eyebrow="Saisie hors ligne"
      title="Terrain"
      description="Préparez un essai pour la saisie de phénotypes hors ligne, puis ouvrez l’espace terrain pour saisir des évaluations sans connexion réseau."
    />
  );

  if (programsState.status === "error") {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ErrorState
          message={programsState.message}
          retryHref="/app/field-packs"
        />
      </div>
    );
  }
  const programs = programsState.data;
  const program = programs.find((p) => p.id === params.program) ?? programs[0];
  const programId = program?.id;

  if (!programId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <EmptyState
          title="Aucun programme"
          message="Rejoignez ou créez un programme avant de préparer un essai pour le terrain."
          action={{ label: "Retour à l’accueil", href: "/app" }}
        />
      </div>
    );
  }

  const trials = await listTrials(programId);

  return (
    <div className="page">
      {breadcrumbs}
      {header}
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs}
        activeId={programId}
        basePath="/app/field-packs"
      />

      {trials.length === 0 ? (
        <EmptyState
          title="Aucun essai"
          message="Aucun essai multi-environnement n’existe pour ce programme. Créez-en un depuis la page Essais avant de le préparer pour le terrain."
          action={{ label: "Essais multi-environnements", href: "/app/trials" }}
        />
      ) : (
        <div className="section-grid">
          {trials.map((trial) => (
            <Card key={trial.id}>
              <h3 className="chart-title">{trial.name}</h3>
              <p className="chart-description">
                <code>{trial.code}</code>
                {trial.description ? ` — ${trial.description}` : null}
              </p>
              <FieldPackCard
                trialId={trial.id}
                trialCode={trial.code}
                trialName={trial.name}
                profileId={profile.id}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
