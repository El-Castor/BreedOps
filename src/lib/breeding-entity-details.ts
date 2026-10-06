import type {
  BreedingEntityDetail,
  DetailField,
  RelationGroup,
} from "@/components/entity-inspector";

type Parent = {
  id: string;
  parent_code: string;
  line_name: string | null;
  generation: number | null;
  origin: string | null;
  description: string | null;
  accession: string | null;
  source: string | null;
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
  /** Yields computed by PostgreSQL (`program_cross_yields`). */
  crossYields: { cross_id: string; seed_yield: number | null }[];
  germinationTests: Germination[];
  phenotypes: Phenotype[];
  evaluations: Evaluation[];
};

const statusLabels: Record<string, string> = {
  active: "Actif",
  planned: "Planifié",
  completed: "Terminé",
  cancelled: "Annulé",
  inactive: "Inactif",
};
const priorityLabels: Record<string, string> = {
  low: "basse",
  medium: "moyenne",
  high: "haute",
  critical: "critique",
};
const purityLabels: Record<string, string> = {
  unknown: "Non vérifiée",
  verified: "Vérifiée",
  pending: "En cours",
  failed: "Non conforme",
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;

const unitLabels: Record<string, string> = { seeds: "graines" };
export const unitLabel = (unit: string) => unitLabels[unit] ?? unit;

const value = (input: unknown) =>
  input === null || input === undefined || input === "" ? "—" : String(input);

// Dates are formatted from the stored ISO text so server and client render the
// same value regardless of the runtime time zone.
export function formatDay(input: string | null | undefined) {
  const match = input?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function formatMoment(input: string | null | undefined) {
  const time = input?.match(/T(\d{2}:\d{2})/)?.[1];
  return input ? `${formatDay(input)}${time ? ` · ${time} UTC` : ""}` : "—";
}

const field = (label: string, input: unknown, wide = false): DetailField => ({
  label,
  value: value(input),
  wide,
});

type Ref = { id: string; code: string; archived: boolean };

const refs = <T extends { id: string; deleted_at: string | null }>(
  records: T[],
  code: (record: T) => string,
): Ref[] =>
  records.map((record) => ({
    id: record.id,
    code: code(record),
    archived: Boolean(record.deleted_at),
  }));

export function buildBreedingEntityDetails(
  source: BreedingDetailSource,
): BreedingEntityDetail[] {
  const parentById = new Map(source.parents.map((item) => [item.id, item]));
  const crossById = new Map(source.crosses.map((item) => [item.id, item]));
  const familyById = new Map(source.families.map((item) => [item.id, item]));
  const yieldByCross = new Map(
    source.crossYields.map((item) => [item.cross_id, item.seed_yield]),
  );
  const evaluationsByPhenotype = new Map<string, Evaluation[]>();
  for (const evaluation of source.evaluations) {
    const values = evaluationsByPhenotype.get(evaluation.phenotype_id) ?? [];
    values.push(evaluation);
    evaluationsByPhenotype.set(evaluation.phenotype_id, values);
  }

  // Evaluations arrive newest first; only PostgreSQL-computed values are shown.
  const phenotypeSummary = (
    phenotypes: Phenotype[],
  ): BreedingEntityDetail["phenotypes"] => {
    const items = phenotypes.map((phenotype) => {
      const latest = evaluationsByPhenotype.get(phenotype.id)?.[0];
      return {
        code: phenotype.phenotype_code,
        decision: latest?.automatic_decision ?? null,
        weightedScore:
          latest?.weighted_score == null ? null : String(latest.weighted_score),
        normalizedScore:
          latest?.normalized_score == null
            ? null
            : String(latest.normalized_score),
        evaluationDate: latest?.evaluation_date ?? null,
      };
    });
    const latest = items
      .filter((item) => item.evaluationDate)
      .sort((a, b) =>
        (b.evaluationDate ?? "").localeCompare(a.evaluationDate ?? ""),
      )[0];
    const dated = (item: (typeof items)[number]) => ({
      ...item,
      evaluationDate: item.evaluationDate
        ? formatDay(item.evaluationDate)
        : null,
    });
    return {
      count: items.length,
      evaluated: items.filter((item) => item.decision).length,
      latest: latest ? dated(latest) : null,
      items: items.map(dated),
    };
  };

  const relation = (label: string, items: Ref[]): RelationGroup => ({
    label,
    items,
  });
  const parentRef = (id: string | undefined): Ref[] => {
    const parent = id ? parentById.get(id) : undefined;
    return parent ? refs([parent], (item) => item.parent_code) : [];
  };
  const pedigreeHref = (kind: string, id: string) =>
    `/app/pedigree?program=${source.program.id}&entity=${kind}:${id}`;
  const programFields = (): DetailField[] => [
    field("Programme", `${source.program.code} · ${source.program.name}`),
    field("Espèce", source.program.species),
    field("Campagne", source.program.campaign),
  ];
  const timestamps = (record: {
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }): DetailField[] => [
    field("Créé le", formatMoment(record.created_at)),
    field("Mis à jour le", formatMoment(record.updated_at)),
    ...(record.deleted_at
      ? [field("Archivé le", formatMoment(record.deleted_at))]
      : []),
  ];
  const phenotypesFor = (familyIds: Set<string>, lotIds: Set<string>) =>
    source.phenotypes.filter(
      (item) =>
        (item.family_id && familyIds.has(item.family_id)) ||
        (item.seed_lot_id && lotIds.has(item.seed_lot_id)),
    );
  const latestGermination = (lotId: string) =>
    source.germinationTests
      .filter((item) => item.seed_lot_id === lotId)
      .sort((a, b) => (b.test_date ?? "").localeCompare(a.test_date ?? ""))[0];
  const seedFields = (lots: Lot[]): DetailField[] => {
    const active = lots.filter((lot) => !lot.deleted_at);
    const total = active.reduce(
      (sum, lot) => sum + Number(lot.total_quantity ?? 0),
      0,
    );
    const tested = lots.filter((lot) => latestGermination(lot.id)).length;
    return [
      field("Lots", lots.length || "Aucun"),
      field("Quantité active", active.length ? `${total} graines` : null),
      field(
        "Lots testés en germination",
        lots.length ? `${tested} / ${lots.length}` : null,
      ),
    ];
  };

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
      status: statusLabel(parent.status),
      generation: parent.generation,
      archived: Boolean(parent.deleted_at),
      lifecycleEntity: "parent_lines",
      pedigreeHref: pedigreeHref("parent", parent.id),
      overview: [
        field("Nom", parent.line_name),
        field("Génération", parent.generation),
        field("Accession", parent.accession),
        field("Source", parent.source),
        field("Origine / provenance", parent.origin, true),
        ...(parent.description
          ? [field("Description", parent.description, true)]
          : []),
        ...programFields(),
        ...timestamps(parent),
      ],
      lineageSummary: `${crosses.length} croisement(s) · ${families.length} famille(s) · ${lots.length} lot(s) descendants`,
      lineage: [
        relation(
          "Croisements utilisant cette lignée",
          refs(crosses, (item) => item.cross_code),
        ),
        relation(
          "Familles descendantes",
          refs(families, (item) => item.family_code),
        ),
      ],
      propagation: { title: "Semences descendantes", fields: seedFields(lots) },
      phenotypes: phenotypeSummary(
        phenotypesFor(familyIds, new Set(lots.map((item) => item.id))),
      ),
      notes: parent.notes,
      edit: {
        type: "parent",
        values: {
          line_name: parent.line_name ?? "",
          generation:
            parent.generation == null ? "" : String(parent.generation),
          accession: parent.accession ?? "",
          source: parent.source ?? "",
          origin: parent.origin ?? "",
          description: parent.description ?? "",
          notes: parent.notes ?? "",
        },
      },
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
    const female = parentById.get(cross.female_parent_id);
    const male = parentById.get(cross.male_parent_id);
    return {
      id: cross.id,
      kind: "cross",
      code: cross.cross_code,
      title: `${female?.parent_code ?? "—"} × ${male?.parent_code ?? "—"}`,
      status: `${statusLabel(cross.status)} · priorité ${priorityLabels[cross.priority] ?? cross.priority}`,
      generation: cross.generation,
      archived: Boolean(cross.deleted_at),
      lifecycleEntity: "crosses",
      pedigreeHref: pedigreeHref("cross", cross.id),
      overview: [
        field("Génération", cross.generation),
        field("Traits ciblés", cross.target_traits),
        ...programFields(),
        ...timestamps(cross),
      ],
      lineageSummary: `2 parents · ${families.length} famille(s) · ${lots.length} lot(s) descendants`,
      lineage: [
        relation("Parent femelle", parentRef(female?.id)),
        relation("Parent mâle", parentRef(male?.id)),
        relation(
          "Familles issues",
          refs(families, (item) => item.family_code),
        ),
        relation(
          "Lots issus",
          refs(lots, (item) => item.seed_lot_code),
        ),
      ],
      propagation: {
        title: "Pollinisation et récolte",
        fields: [
          field("Pollinisation", formatDay(cross.pollination_date)),
          field("Récolte", formatDay(cross.harvest_date)),
          field("Unités pollinisées", cross.pollinated_units),
          field("Unités établies", cross.established_units),
          field("Graines", cross.total_seeds),
          field(
            "Rendement (graines / unité)",
            yieldByCross.get(cross.id) ?? null,
          ),
        ],
      },
      phenotypes: phenotypeSummary(
        phenotypesFor(familyIds, new Set(lots.map((item) => item.id))),
      ),
      notes: cross.notes,
      edit: { type: "cross", status: cross.status, notes: cross.notes ?? "" },
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
      status: statusLabel(family.status),
      generation: family.generation,
      archived: Boolean(family.deleted_at),
      lifecycleEntity: "families",
      pedigreeHref: pedigreeHref("family", family.id),
      overview: [
        field("Génération", family.generation),
        ...programFields(),
        ...timestamps(family),
      ],
      lineageSummary: `${cross ? "1 croisement · 2 parents" : "Origine indisponible"} · ${lots.length} lot(s) descendants`,
      lineage: [
        relation(
          "Croisement source",
          cross ? refs([cross], (item) => item.cross_code) : [],
        ),
        relation("Parent femelle", parentRef(cross?.female_parent_id)),
        relation("Parent mâle", parentRef(cross?.male_parent_id)),
        relation(
          "Lots de graines",
          refs(lots, (item) => item.seed_lot_code),
        ),
      ],
      propagation: { title: "Semences", fields: seedFields(lots) },
      phenotypes: phenotypeSummary(
        phenotypesFor(
          new Set([family.id]),
          new Set(lots.map((item) => item.id)),
        ),
      ),
      notes: family.notes,
      edit: { type: "notes", entity: "families", notes: family.notes ?? "" },
    };
  });

  const lots = source.lots.map((lot): BreedingEntityDetail => {
    const germination = latestGermination(lot.id);
    const family = familyById.get(lot.family_id ?? "");
    const cross = crossById.get(lot.cross_id ?? family?.cross_id ?? "");
    return {
      id: lot.id,
      kind: "lot",
      code: lot.seed_lot_code,
      title: family
        ? `Famille ${family.family_code}`
        : "Lot sans famille disponible",
      status: statusLabel(lot.status),
      generation: family?.generation ?? null,
      archived: Boolean(lot.deleted_at),
      lifecycleEntity: "seed_lots",
      pedigreeHref: pedigreeHref("lot", lot.id),
      overview: [
        field(
          "Pureté génétique",
          purityLabels[lot.genetic_purity_status] ?? lot.genetic_purity_status,
        ),
        field("Vérification", lot.verification_method),
        ...programFields(),
        ...timestamps(lot),
      ],
      lineageSummary:
        [family && "1 famille", cross && "1 croisement · 2 parents"]
          .filter(Boolean)
          .join(" · ") || "Lignée indisponible",
      lineage: [
        relation(
          "Famille",
          family ? refs([family], (item) => item.family_code) : [],
        ),
        relation(
          "Croisement",
          cross ? refs([cross], (item) => item.cross_code) : [],
        ),
        relation("Parent femelle", parentRef(cross?.female_parent_id)),
        relation("Parent mâle", parentRef(cross?.male_parent_id)),
      ],
      propagation: {
        title: "Semences et germination",
        fields: [
          field("Récolte", formatDay(lot.harvest_date)),
          field(
            "Quantité",
            lot.total_quantity == null
              ? null
              : `${lot.total_quantity} ${unitLabel(lot.quantity_unit)}`,
          ),
          field("Stockage", lot.storage_location),
          field(
            "Dernière germination",
            germination
              ? `${value(germination.germination_rate)} % · ${value(germination.seeds_germinated)}/${value(germination.seeds_tested)}`
              : "Aucun test",
          ),
          field(
            "Date du test",
            germination ? formatDay(germination.test_date) : null,
          ),
          field("Méthode", germination?.method),
        ],
      },
      phenotypes: phenotypeSummary(
        source.phenotypes.filter((item) => item.seed_lot_id === lot.id),
      ),
      notes: lot.notes,
      edit: { type: "notes", entity: "seed_lots", notes: lot.notes ?? "" },
    };
  });

  return [...parents, ...crosses, ...families, ...lots];
}
