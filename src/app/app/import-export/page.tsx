import {
  Breadcrumbs,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { ImportExportWorkspace } from "./workspace";

export default async function ImportExportPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const { client, team, profile } = await requireIdentity();
  const params = await searchParams;

  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger les programmes.",
  );
  if (programsState.status === "error") {
    return (
      <div className="page">
        <ErrorState
          message={programsState.message}
          retryHref="/app/import-export"
        />
      </div>
    );
  }
  const programs = programsState.data ?? [];
  const program =
    programs.find((item) => item.id === params.program) ?? programs[0];

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: "Accueil", href: "/app" },
          { label: "Import / Export" },
        ]}
      />
      <PageHeader
        eyebrow="Flux de données"
        title="Import / Export"
        description="Importez un classeur CSV ou Excel après prévisualisation et validation, ou exportez vos registres et une sauvegarde fonctionnelle."
      />
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs}
        activeId={program?.id}
        basePath="/app/import-export"
      />
      <ImportExportWorkspace
        programId={program?.id ?? null}
        organizationId={profile.organization_id}
      />
    </div>
  );
}
