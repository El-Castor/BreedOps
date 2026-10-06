import Link from "next/link";
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
import { collectionState } from "@/lib/query-state";

export default async function PedigreePage({
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
  const [parentsResult, crossesResult, familiesResult, lotsResult] =
    await Promise.all([
      client
        .from("parent_lines")
        .select("id,parent_code,line_name,generation")
        .eq("program_id", program.id)
        .is("deleted_at", null)
        .order("parent_code"),
      client
        .from("crosses")
        .select("id,cross_code,female_parent_id,male_parent_id,status")
        .eq("program_id", program.id)
        .is("deleted_at", null)
        .order("cross_code"),
      client
        .from("families")
        .select("id,family_code,cross_id,generation,status")
        .eq("program_id", program.id)
        .is("deleted_at", null)
        .order("family_code"),
      client
        .from("seed_lots")
        .select(
          "id,seed_lot_code,cross_id,family_id,total_quantity,quantity_unit,status",
        )
        .eq("program_id", program.id)
        .is("deleted_at", null)
        .order("seed_lot_code"),
    ]);
  const parentState = collectionState(
    parentsResult,
    "Impossible de charger les parents.",
  );
  const crossState = collectionState(
    crossesResult,
    "Impossible de charger les croisements.",
  );
  const familyState = collectionState(
    familiesResult,
    "Impossible de charger les familles.",
  );
  const lotState = collectionState(
    lotsResult,
    "Impossible de charger les lots.",
  );
  const states = [parentState, crossState, familyState, lotState];
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
  const parents = parentState.data;
  const crosses = crossState.data;
  const families = familyState.data;
  const lots = lotState.data;
  const parentCode = (id: string) =>
    parents.find((item) => item.id === id)?.parent_code ?? "—";
  const crossCode = (id: string | null) =>
    crosses.find((item) => item.id === id)?.cross_code ?? "—";
  const familyCode = (id: string | null) =>
    families.find((item) => item.id === id)?.family_code ?? "—";
  const nodes: PedigreeNode[] = [
    ...parents.map((item) => ({
      id: item.id,
      kind: "parent" as const,
      code: item.parent_code,
      name: item.line_name,
      generation: item.generation,
      details: [
        `Nom : ${item.line_name}`,
        item.generation == null
          ? "Génération non renseignée"
          : `Génération : ${item.generation}`,
      ],
    })),
    ...crosses.map((item) => ({
      id: item.id,
      kind: "cross" as const,
      code: item.cross_code,
      details: [
        `Parents : ${parentCode(item.female_parent_id)} × ${parentCode(item.male_parent_id)}`,
        `État : ${item.status}`,
      ],
    })),
    ...families.map((item) => ({
      id: item.id,
      kind: "family" as const,
      code: item.family_code,
      generation: item.generation,
      details: [
        `Croisement : ${crossCode(item.cross_id)}`,
        `État : ${item.status}`,
      ],
    })),
    ...lots.map((item) => ({
      id: item.id,
      kind: "lot" as const,
      code: item.seed_lot_code,
      details: [
        `Famille : ${familyCode(item.family_id)}`,
        `Croisement : ${crossCode(item.cross_id)}`,
        `Quantité : ${item.total_quantity} ${item.quantity_unit}`,
      ],
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
  return (
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
        description="Explorez les relations réelles du programme, des lignées parentales aux lots de graines."
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
        <nav className="chip-nav">
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
        <PedigreeGraph nodes={nodes} edges={edges} />
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
  );
}
