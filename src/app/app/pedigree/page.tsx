import Link from "next/link";
import { EntityInspectorWorkspace } from "@/components/entity-inspector";
import {
  Breadcrumbs,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
} from "@/components/ui";
import {
  PedigreeGraph,
  type PedigreeEdge,
  type PedigreeNode,
} from "@/components/pedigree-graph";
import { requireIdentity } from "@/lib/auth";
import {
  buildBreedingEntityDetails,
  type BreedingDetailSource,
} from "@/lib/breeding-entity-details";
import { collectionState } from "@/lib/query-state";

export default async function PedigreePage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; entity?: string }>;
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
        <ErrorState message={programsState.message} retryHref="/app/pedigree" />
      </div>
    );
  const programs = programsState.data;
  const program =
    programs.find((item) => item.id === params.program) ?? programs[0];
  if (!program)
    return (
      <div className="page">
        <PageHeader eyebrow="Traçabilité" title="Pedigree" />
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant d’afficher son pedigree."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      </div>
    );

  const results = await Promise.all([
    client
      .from("parent_lines")
      .select(
        "id,parent_code,line_name,generation,origin,description,status,notes,created_at,updated_at,deleted_at",
      )
      .eq("program_id", program.id)
      .order("parent_code"),
    client
      .from("crosses")
      .select(
        "id,cross_code,female_parent_id,male_parent_id,generation,target_traits,pollination_date,harvest_date,pollinated_units,established_units,total_seeds,status,priority,notes,created_at,updated_at,deleted_at",
      )
      .eq("program_id", program.id)
      .order("cross_code"),
    client
      .from("families")
      .select(
        "id,family_code,cross_id,generation,status,notes,created_at,updated_at,deleted_at",
      )
      .eq("program_id", program.id)
      .order("family_code"),
    client
      .from("seed_lots")
      .select(
        "id,seed_lot_code,cross_id,family_id,harvest_date,total_quantity,quantity_unit,storage_location,genetic_purity_status,verification_method,status,notes,created_at,updated_at,deleted_at",
      )
      .eq("program_id", program.id)
      .order("seed_lot_code"),
    client
      .from("phenotypes")
      .select("id,phenotype_code,family_id,seed_lot_id")
      .eq("program_id", program.id)
      .is("deleted_at", null),
  ]);
  const states = [
    collectionState(results[0], "Impossible de charger les parents."),
    collectionState(results[1], "Impossible de charger les croisements."),
    collectionState(results[2], "Impossible de charger les familles."),
    collectionState(results[3], "Impossible de charger les lots."),
    collectionState(results[4], "Impossible de charger les phénotypes."),
  ];
  const failed = states.find((state) => state.status === "error");
  if (failed?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={failed.message}
          retryHref={`/app/pedigree?program=${program.id}`}
        />
      </div>
    );
  const parents = states[0].data as BreedingDetailSource["parents"];
  const crosses = states[1].data as BreedingDetailSource["crosses"];
  const families = states[2].data as BreedingDetailSource["families"];
  const lots = states[3].data as BreedingDetailSource["lots"];
  const phenotypes = states[4].data as BreedingDetailSource["phenotypes"];
  const empty = { data: [], error: null };
  const germinationState = collectionState(
    lots.length
      ? await client
          .from("germination_tests")
          .select(
            "seed_lot_id,test_date,seeds_tested,seeds_germinated,germination_rate,method",
          )
          .in(
            "seed_lot_id",
            lots.map((item) => item.id),
          )
          .is("deleted_at", null)
      : empty,
    "Impossible de charger la germination.",
  );
  const evaluationsState = collectionState(
    phenotypes.length
      ? await client
          .from("phenotype_evaluations")
          .select(
            "phenotype_id,evaluation_date,weighted_score,normalized_score,automatic_decision",
          )
          .in(
            "phenotype_id",
            phenotypes.map((item) => item.id),
          )
          .is("deleted_at", null)
          .order("evaluation_date", { ascending: false })
      : empty,
    "Impossible de charger les évaluations.",
  );
  const dependentFailure = [germinationState, evaluationsState].find(
    (state) => state.status === "error",
  );
  if (dependentFailure?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={dependentFailure.message}
          retryHref={`/app/pedigree?program=${program.id}`}
        />
      </div>
    );

  const details = buildBreedingEntityDetails({
    program,
    parents,
    crosses,
    families,
    lots,
    germinationTests:
      germinationState.data as BreedingDetailSource["germinationTests"],
    phenotypes,
    evaluations: evaluationsState.data as BreedingDetailSource["evaluations"],
  });
  const detail = (kind: string, id: string) => {
    const found = details.find((item) => item.kind === kind && item.id === id);
    if (!found) throw new Error("Missing pedigree entity detail");
    return found;
  };
  const nodes: PedigreeNode[] = [
    ...parents.map((item) => ({
      id: item.id,
      kind: "parent" as const,
      code: item.parent_code,
      name: item.line_name,
      generation: item.generation,
      entity: detail("parent", item.id),
    })),
    ...crosses.map((item) => ({
      id: item.id,
      kind: "cross" as const,
      code: item.cross_code,
      generation: item.generation,
      entity: detail("cross", item.id),
    })),
    ...families.map((item) => ({
      id: item.id,
      kind: "family" as const,
      code: item.family_code,
      generation: item.generation,
      entity: detail("family", item.id),
    })),
    ...lots.map((item) => ({
      id: item.id,
      kind: "lot" as const,
      code: item.seed_lot_code,
      entity: detail("lot", item.id),
    })),
  ];
  const edges: PedigreeEdge[] = [
    ...crosses.flatMap((item) => [
      { from: item.female_parent_id, to: item.id },
      { from: item.male_parent_id, to: item.id },
    ]),
    ...families.map((item) => ({ from: item.cross_id, to: item.id })),
    ...lots.flatMap((item) =>
      item.family_id
        ? [{ from: item.family_id, to: item.id }]
        : item.cross_id
          ? [{ from: item.cross_id, to: item.id }]
          : [],
    ),
  ];
  const selectedId = params.entity?.split(":", 2)[1] ?? null;
  return (
    <EntityInspectorWorkspace>
      <div className="page">
        <Breadcrumbs
          items={[
            { label: "Accueil", href: "/app" },
            { label: "Programme", href: `/app/breeding?program=${program.id}` },
            { label: "Pedigree" },
          ]}
        />
        <PageHeader
          eyebrow="Traçabilité"
          title="Pedigree interactif"
          description="Explorez les relations réelles, y compris les enregistrements archivés conservés dans la lignée historique."
          actions={
            <Link
              className="button-link secondary"
              href={`/app/breeding?program=${program.id}`}
            >
              Ouvrir les registres
            </Link>
          }
        />
        <ProgramContext team={team.name} program={program} />
        <Card className="program-picker">
          <strong>Programme</strong>
          <nav className="chip-nav" aria-label="Changer de programme">
            {programs.map((item) => (
              <Link
                className={item.id === program.id ? "active" : ""}
                key={item.id}
                href={`/app/pedigree?program=${item.id}`}
              >
                {item.code}
              </Link>
            ))}
          </nav>
        </Card>
        {nodes.length ? (
          <PedigreeGraph
            nodes={nodes}
            edges={edges}
            initialSelectedId={selectedId}
          />
        ) : (
          <EmptyState
            title="Pedigree vide"
            message="Ajoutez des lignées parentales pour commencer le pedigree."
            action={{
              label: "Ajouter une lignée",
              href: `/app/breeding?program=${program.id}#parents`,
            }}
          />
        )}
      </div>
    </EntityInspectorWorkspace>
  );
}
