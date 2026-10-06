import type { BreedingEntityDetail } from "@/components/entity-inspector";

type Parent = {
  id: string;
  parent_code: string;
  line_name: string | null;
  generation: number | null;
  origin: string | null;
  description: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type Cross = {
  id: string;
  cross_code: string;
  female_parent_id: string;
  male_parent_id: string;
  generation: number | null;
  target_traits: string | null;
  pollination_date: string | null;
  harvest_date: string | null;
  pollinated_units: number | null;
  established_units: number | null;
  total_seeds: number | null;
  status: string;
  priority: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type Family = {
  id: string;
  family_code: string;
  cross_id: string;
  generation: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type Lot = {
  id: string;
  seed_lot_code: string;
  cross_id: string | null;
  family_id: string | null;
  harvest_date: string | null;
  total_quantity: number | null;
  quantity_unit: string;
  storage_location: string | null;
  genetic_purity_status: string;
  verification_method: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type Germination = {
  seed_lot_id: string;
  test_date: string | null;
  seeds_tested: number | null;
  seeds_germinated: number | null;
  germination_rate: number | null;
  method: string | null;
};
type Phenotype = {
  id: string;
  phenotype_code: string;
  family_id: string | null;
  seed_lot_id: string | null;
};
type Evaluation = {
  phenotype_id: string;
  evaluation_date: string | null;
  weighted_score: number | null;
  normalized_score: number | null;
  automatic_decision: string | null;
};

export type BreedingDetailSource = {
  program: {
    id: string;
    code: string;
    name: string;
    species?: string | null;
    campaign?: string | null;
  };
  parents: Parent[];
  crosses: Cross[];
  families: Family[];
  lots: Lot[];
  germinationTests: Germination[];
  phenotypes: Phenotype[];
  evaluations: Evaluation[];
};

type Field = BreedingEntityDetail["sections"][number]["fields"][number];

const value = (input: unknown) =>
  input === null || input === undefined || input === "" ? "—" : String(input);

// Dates are formatted from the stored ISO text so server and client render the
// same value regardless of the runtime time zone.
function day(input: string | null | undefined) {
  const match = input?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function moment(input: string | null | undefined) {
  const time = input?.match(/T(\d{2}:\d{2})/)?.[1];
  return input ? `${day(input)}${time ? ` · ${time} UTC` : ""}` : "—";
}

const list = (codes: string[]) => codes.join(", ") || "Aucun";

const section = (title: string, fields: Field[]) => ({ title, fields });

export function buildBreedingEntityDetails(
  source: BreedingDetailSource,
): BreedingEntityDetail[] {
  const parentById = new Map(source.parents.map((item) => [item.id, item]));
  const crossById = new Map(source.crosses.map((item) => [item.id, item]));
  const familyById = new Map(source.families.map((item) => [item.id, item]));
  const evaluationsByPhenotype = new Map<string, Evaluation[]>();
  for (const evaluation of source.evaluations) {
    const values = evaluationsByPhenotype.get(evaluation.phenotype_id) ?? [];
    values.push(evaluation);
    evaluationsByPhenotype.set(evaluation.phenotype_id, values);
  }
  // Evaluations arrive newest first; the summary shows each phenotype's latest
  // PostgreSQL-computed result rather than recalculating anything here.
  const summary = (
    phenotypes: Phenotype[],
  ): BreedingEntityDetail["phenotypeSummary"] =>
    phenotypes.map((phenotype) => {
      const latest = evaluationsByPhenotype.get(phenotype.id)?.[0];
      return {
        code: phenotype.phenotype_code,
        decision: latest?.automatic_decision ?? null,
        weightedScore:
          latest?.weighted_score == null ? null : value(latest.weighted_score),
        normalizedScore:
          latest?.normalized_score == null
            ? null
            : value(latest.normalized_score),
        evaluationDate: latest?.evaluation_date
          ? day(latest.evaluation_date)
          : null,
      };
    });
  const pedigreeHref = (kind: string, id: string) =>
    `/app/pedigree?program=${source.program.id}&entity=${kind}:${id}`;
  const programFields = (): Field[] => [
    {
      label: "Programme",
      value: `${source.program.code} · ${source.program.name}`,
    },
    { label: "Espèce", value: value(source.program.species) },
    { label: "Campagne", value: value(source.program.campaign) },
  ];
  const metadata = (record: {
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    notes: string | null;
  }) =>
    section("Métadonnées", [
      { label: "Créé le", value: moment(record.created_at) },
      { label: "Mis à jour le", value: moment(record.updated_at) },
      ...(record.deleted_at
        ? [{ label: "Archivé le", value: moment(record.deleted_at) }]
        : []),
      { label: "Notes", value: value(record.notes) },
    ]);
  const parentCode = (parentId: string) =>
    parentById.get(parentId)?.parent_code ?? "—";
  const lineagePhenotypes = (familyIds: Set<string>, lotIds: Set<string>) =>
    source.phenotypes.filter(
      (item) =>
        (item.family_id && familyIds.has(item.family_id)) ||
        (item.seed_lot_id && lotIds.has(item.seed_lot_id)),
    );
  const latestGermination = (lotId: string) =>
    source.germinationTests
      .filter((item) => item.seed_lot_id === lotId)
      .sort((a, b) => (b.test_date ?? "").localeCompare(a.test_date ?? ""))[0];

  const parents = source.parents.map((parent): BreedingEntityDetail => {
    const crosses = source.crosses.filter(
      (item) =>
        item.female_parent_id === parent.id ||
        item.male_parent_id === parent.id,
    );
    const crossIds = new Set(crosses.map((item) => item.id));
    const families = source.families.filter((item) =>
      crossIds.has(item.cross_id),
    );
    const familyIds = new Set(families.map((item) => item.id));
    const lots = source.lots.filter(
      (item) =>
        (item.cross_id && crossIds.has(item.cross_id)) ||
        (item.family_id && familyIds.has(item.family_id)),
    );
    return {
      id: parent.id,
      kind: "parent",
      code: parent.parent_code,
      title: parent.line_name || "Lignée sans nom",
      status: parent.status,
      archived: Boolean(parent.deleted_at),
      lifecycleEntity: "parent_lines",
      pedigreeHref: pedigreeHref("parent", parent.id),
      sections: [
        section("Identité", [
          { label: "Code BreedOps", value: parent.parent_code },
          { label: "Nom", value: value(parent.line_name) },
          { label: "Génération", value: value(parent.generation) },
          ...programFields(),
        ]),
        section("Lignée", [
          { label: "Origine", value: value(parent.origin) },
          { label: "Description", value: value(parent.description) },
          {
            label: "Croisements utilisant cette lignée",
            value: list(crosses.map((item) => item.cross_code)),
          },
          {
            label: "Descendance",
            value: `${families.length} famille(s) · ${lots.length} lot(s)`,
          },
        ]),
        section("Semences et propagation", [
          {
            label: "Lots descendants",
            value: list(lots.map((item) => item.seed_lot_code)),
          },
        ]),
        metadata(parent),
      ],
      phenotypeSummary: summary(
        lineagePhenotypes(familyIds, new Set(lots.map((item) => item.id))),
      ),
    };
  });

  const crosses = source.crosses.map((cross): BreedingEntityDetail => {
    const families = source.families.filter(
      (item) => item.cross_id === cross.id,
    );
    const familyIds = new Set(families.map((item) => item.id));
    const lots = source.lots.filter(
      (item) =>
        item.cross_id === cross.id ||
        (item.family_id && familyIds.has(item.family_id)),
    );
    // Yield is shown as stored inputs only; PostgreSQL remains authoritative
    // for derived business values.
    return {
      id: cross.id,
      kind: "cross",
      code: cross.cross_code,
      title: `${parentCode(cross.female_parent_id)} × ${parentCode(cross.male_parent_id)}`,
      status: `${cross.status} · priorité ${cross.priority}`,
      archived: Boolean(cross.deleted_at),
      lifecycleEntity: "crosses",
      pedigreeHref: pedigreeHref("cross", cross.id),
      sections: [
        section("Identité", [
          { label: "Code BreedOps", value: cross.cross_code },
          { label: "Génération", value: value(cross.generation) },
          { label: "Traits cibles", value: value(cross.target_traits) },
          ...programFields(),
        ]),
        section("Lignée", [
          {
            label: "Parent femelle",
            value: parentCode(cross.female_parent_id),
          },
          { label: "Parent mâle", value: parentCode(cross.male_parent_id) },
          {
            label: "Familles issues",
            value: list(families.map((item) => item.family_code)),
          },
        ]),
        section("Pollinisation et récolte", [
          { label: "Pollinisation", value: day(cross.pollination_date) },
          { label: "Récolte", value: day(cross.harvest_date) },
          { label: "Unités pollinisées", value: value(cross.pollinated_units) },
          { label: "Unités établies", value: value(cross.established_units) },
          { label: "Graines", value: value(cross.total_seeds) },
          {
            label: "Lots issus",
            value: list(lots.map((item) => item.seed_lot_code)),
          },
        ]),
        metadata(cross),
      ],
      phenotypeSummary: summary(
        lineagePhenotypes(familyIds, new Set(lots.map((item) => item.id))),
      ),
    };
  });

  const families = source.families.map((family): BreedingEntityDetail => {
    const cross = crossById.get(family.cross_id);
    const lots = source.lots.filter((item) => item.family_id === family.id);
    return {
      id: family.id,
      kind: "family",
      code: family.family_code,
      title: cross
        ? `Issue de ${cross.cross_code}`
        : "Croisement historique indisponible",
      status: family.status,
      archived: Boolean(family.deleted_at),
      lifecycleEntity: "families",
      pedigreeHref: pedigreeHref("family", family.id),
      sections: [
        section("Identité", [
          { label: "Code BreedOps", value: family.family_code },
          { label: "Génération", value: value(family.generation) },
          ...programFields(),
        ]),
        section("Lignée", [
          { label: "Croisement source", value: cross?.cross_code ?? "—" },
          {
            label: "Parent femelle",
            value: cross ? parentCode(cross.female_parent_id) : "—",
          },
          {
            label: "Parent mâle",
            value: cross ? parentCode(cross.male_parent_id) : "—",
          },
        ]),
        section("Semences et propagation", [
          {
            label: "Lots de graines",
            value: list(lots.map((item) => item.seed_lot_code)),
          },
        ]),
        metadata(family),
      ],
      phenotypeSummary: summary(
        lineagePhenotypes(
          new Set([family.id]),
          new Set(lots.map((item) => item.id)),
        ),
      ),
    };
  });

  const lots = source.lots.map((lot): BreedingEntityDetail => {
    const germination = latestGermination(lot.id);
    const family = familyById.get(lot.family_id ?? "");
    return {
      id: lot.id,
      kind: "lot",
      code: lot.seed_lot_code,
      title: family
        ? `Famille ${family.family_code}`
        : "Lot sans famille disponible",
      status: lot.status,
      archived: Boolean(lot.deleted_at),
      lifecycleEntity: "seed_lots",
      pedigreeHref: pedigreeHref("lot", lot.id),
      sections: [
        section("Identité", [
          { label: "Code BreedOps", value: lot.seed_lot_code },
          ...programFields(),
        ]),
        section("Lignée", [
          { label: "Famille", value: family?.family_code ?? "—" },
          {
            label: "Croisement",
            value: crossById.get(lot.cross_id ?? "")?.cross_code ?? "—",
          },
        ]),
        section("Semences et propagation", [
          { label: "Récolte", value: day(lot.harvest_date) },
          {
            label: "Quantité",
            value:
              lot.total_quantity == null
                ? "—"
                : `${lot.total_quantity} ${lot.quantity_unit}`,
          },
          { label: "Stockage", value: value(lot.storage_location) },
          { label: "Pureté génétique", value: lot.genetic_purity_status },
          { label: "Vérification", value: value(lot.verification_method) },
          {
            label: "Dernière germination",
            value: germination
              ? `${value(germination.germination_rate)} % · ${value(germination.seeds_germinated)}/${value(germination.seeds_tested)} · ${day(germination.test_date)}`
              : "Aucun test",
          },
          { label: "Méthode", value: value(germination?.method) },
        ]),
        metadata(lot),
      ],
      phenotypeSummary: summary(
        source.phenotypes.filter((item) => item.seed_lot_id === lot.id),
      ),
    };
  });

  return [...parents, ...crosses, ...families, ...lots];
}
