import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExportTable = {
  headers: string[];
  rows: (string | number | null)[][];
};

function fmt(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

export async function exportParentLines(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("parent_lines")
    .select(
      "parent_code,line_name,generation,origin,accession,source,notes,status,created_at",
    )
    .eq("program_id", programId)
    .order("parent_code");
  const headers = [
    "Parent ID",
    "Nom",
    "Génération",
    "Origine",
    "Accession",
    "Source",
    "Notes",
    "Statut",
    "Créé le",
  ];
  const rows = (data ?? []).map((r) => [
    fmt(r.parent_code),
    fmt(r.line_name),
    fmt(r.generation),
    fmt(r.origin),
    fmt(r.accession),
    fmt(r.source),
    fmt(r.notes),
    fmt(r.status),
    fmt(r.created_at),
  ]);
  return { headers, rows };
}

export async function exportCrosses(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("crosses")
    .select(
      "cross_code,female:parent_lines!crosses_female_parent_id_fkey(parent_code),male:parent_lines!crosses_male_parent_id_fkey(parent_code),generation,target_traits,pollination_date,harvest_date,pollinated_units,established_units,total_seeds,priority,status,notes",
    )
    .eq("program_id", programId)
    .order("cross_code");
  const headers = [
    "Cross ID",
    "Parent femelle (Parent ID)",
    "Parent mâle (Parent ID)",
    "Génération",
    "Caractères ciblés",
    "Date pollinisation",
    "Date récolte",
    "Unités pollinisées",
    "Unités établies",
    "Graines totales",
    "Priorité",
    "Statut",
    "Notes",
  ];
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const female = row.female as { parent_code?: string } | null;
    const male = row.male as { parent_code?: string } | null;
    return [
      fmt(row.cross_code),
      fmt(female?.parent_code),
      fmt(male?.parent_code),
      fmt(row.generation),
      fmt(row.target_traits),
      fmt(row.pollination_date),
      fmt(row.harvest_date),
      fmt(row.pollinated_units),
      fmt(row.established_units),
      fmt(row.total_seeds),
      fmt(row.priority),
      fmt(row.status),
      fmt(row.notes),
    ];
  });
  return { headers, rows };
}

export async function exportFamilies(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("families")
    .select(
      "family_code,cross:crosses!families_cross_id_fkey(cross_code),generation,status,notes",
    )
    .eq("program_id", programId)
    .order("family_code");
  const headers = [
    "Family ID",
    "Croisement (Cross ID)",
    "Génération",
    "Statut",
    "Notes",
  ];
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const cross = row.cross as { cross_code?: string } | null;
    return [
      fmt(row.family_code),
      fmt(cross?.cross_code),
      fmt(row.generation),
      fmt(row.status),
      fmt(row.notes),
    ];
  });
  return { headers, rows };
}

export async function exportSeedLots(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("seed_lots")
    .select(
      "seed_lot_code,cross:crosses!seed_lots_cross_id_fkey(cross_code),family:families!seed_lots_family_id_fkey(family_code),harvest_date,total_quantity,quantity_unit,storage_location,genetic_purity_status,verification_method,status,notes",
    )
    .eq("program_id", programId)
    .order("seed_lot_code");
  const headers = [
    "Seed Lot ID",
    "Croisement (Cross ID)",
    "Famille (Family ID)",
    "Date récolte",
    "Quantité totale",
    "Unité",
    "Emplacement",
    "Pureté génétique",
    "Méthode de vérification",
    "Statut",
    "Notes",
  ];
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const cross = row.cross as { cross_code?: string } | null;
    const family = row.family as { family_code?: string } | null;
    return [
      fmt(row.seed_lot_code),
      fmt(cross?.cross_code),
      fmt(family?.family_code),
      fmt(row.harvest_date),
      fmt(row.total_quantity),
      fmt(row.quantity_unit),
      fmt(row.storage_location),
      fmt(row.genetic_purity_status),
      fmt(row.verification_method),
      fmt(row.status),
      fmt(row.notes),
    ];
  });
  return { headers, rows };
}

export async function exportPhenotypes(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("phenotypes")
    .select(
      "phenotype_code,family:families!phenotypes_family_id_fkey(family_code),seed_lot:seed_lots!phenotypes_seed_lot_id_fkey(seed_lot_code),block,replicate,location,status,notes",
    )
    .eq("program_id", programId)
    .order("phenotype_code");
  const headers = [
    "Phenotype ID",
    "Famille (Family ID)",
    "Lot de graines (Seed Lot ID)",
    "Bloc",
    "Répétition",
    "Emplacement",
    "Statut",
    "Notes",
  ];
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const family = row.family as { family_code?: string } | null;
    const seedLot = row.seed_lot as { seed_lot_code?: string } | null;
    return [
      fmt(row.phenotype_code),
      fmt(family?.family_code),
      fmt(seedLot?.seed_lot_code),
      fmt(row.block),
      fmt(row.replicate),
      fmt(row.location),
      fmt(row.status),
      fmt(row.notes),
    ];
  });
  return { headers, rows };
}

/** Analytical selection matrix — not a generic importable/exportable entity
 * (criteria are configurable per program, never a fixed business-code
 * schema), so this is export-only and reuses the same export route/audit
 * path rather than being registered in ENTITY_SPECS. Columns: stable
 * identifier, one per active criterion of the program's active selection
 * model, weighted score, normalized score, eliminatory status/reason, and
 * final decision — everything a user needs to see WHY an individual was
 * (or wasn't) selected, without opening the application. */
export async function exportPhenotypeSelectionMatrix(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data: model } = await client
    .from("selection_models")
    .select("id")
    .eq("program_id", programId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const { data: criteria } = model
    ? await client
        .from("selection_criteria")
        .select("id,code,name,is_eliminatory,eliminatory_threshold")
        .eq("selection_model_id", model.id)
        .is("deleted_at", null)
        .order("display_order")
    : { data: [] };
  const criterionList = criteria ?? [];

  const { data: phenotypes } = await client
    .from("phenotypes")
    .select("id,phenotype_code")
    .eq("program_id", programId)
    .order("phenotype_code");
  const phenotypeList = phenotypes ?? [];
  const phenotypeIds = phenotypeList.map((item) => item.id);

  const { data: evaluationsRaw } = phenotypeIds.length
    ? await client
        .from("phenotype_evaluations")
        .select(
          "id,phenotype_id,weighted_score,normalized_score,automatic_decision,is_eliminated,elimination_reasons,evaluation_date",
        )
        .in("phenotype_id", phenotypeIds)
        .is("deleted_at", null)
        .order("evaluation_date", { ascending: false })
    : { data: [] };
  // Most recent evaluation per phenotype only — a matrix reflects current
  // standing, not the full evaluation history (already covered elsewhere).
  type EvaluationRow = {
    id: string;
    phenotype_id: string;
    weighted_score: number | null;
    normalized_score: number | null;
    automatic_decision: string | null;
    is_eliminated: boolean;
    elimination_reasons: string[] | null;
    evaluation_date: string | null;
  };
  const latestByPhenotype = new Map<string, EvaluationRow>();
  for (const evaluation of (evaluationsRaw ?? []) as EvaluationRow[]) {
    if (!latestByPhenotype.has(evaluation.phenotype_id)) {
      latestByPhenotype.set(evaluation.phenotype_id, evaluation);
    }
  }
  const evaluationIds = [...latestByPhenotype.values()].map((item) => item.id);
  const { data: scores } = evaluationIds.length
    ? await client
        .from("phenotype_scores")
        .select("phenotype_evaluation_id,criterion_id,raw_score")
        .in("phenotype_evaluation_id", evaluationIds)
        .is("deleted_at", null)
    : { data: [] };
  const scoreByEvaluationAndCriterion = new Map<string, number>();
  for (const score of scores ?? []) {
    scoreByEvaluationAndCriterion.set(
      `${score.phenotype_evaluation_id}:${score.criterion_id}`,
      score.raw_score,
    );
  }

  const headers = [
    "Phenotype ID",
    ...criterionList.map(
      (c) => `${c.name}${c.is_eliminatory ? " (éliminatoire)" : ""}`,
    ),
    "Score pondéré",
    "Score normalisé (%)",
    "Éliminé par critère",
    "Motif d’élimination",
    "Décision finale",
  ];
  const rows = phenotypeList.map((phenotype) => {
    const evaluation = latestByPhenotype.get(phenotype.id);
    const criterionValues = criterionList.map((criterion) =>
      evaluation
        ? fmt(
            scoreByEvaluationAndCriterion.get(
              `${evaluation.id}:${criterion.id}`,
            ) ?? null,
          )
        : null,
    );
    return [
      fmt(phenotype.phenotype_code),
      ...criterionValues,
      fmt(evaluation?.weighted_score ?? null),
      fmt(evaluation?.normalized_score ?? null),
      evaluation ? (evaluation.is_eliminated ? "Oui" : "Non") : null,
      fmt((evaluation?.elimination_reasons ?? []).join(" · ") || null),
      fmt(evaluation?.automatic_decision ?? null),
    ];
  });
  return { headers, rows };
}

export async function exportInventoryLots(
  client: SupabaseClient,
  organizationId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("inventory_lots")
    .select(
      "batch_number,item:inventory_items!inventory_lots_inventory_item_id_fkey(name,organization_id),received_at,expiration_date,current_quantity,storage_location,status,notes",
    )
    .eq("item.organization_id", organizationId)
    .order("batch_number");
  const headers = [
    "Article",
    "N° de lot (Lot Number)",
    "Date réception",
    "Date péremption",
    "Quantité actuelle",
    "Emplacement",
    "Statut",
    "Notes",
  ];
  const rows = (data ?? [])
    .filter((r) => (r as unknown as Record<string, unknown>).item)
    .map((r) => {
      const row = r as unknown as Record<string, unknown>;
      const item = row.item as { name?: string } | null;
      return [
        fmt(item?.name),
        fmt(row.batch_number),
        fmt(row.received_at),
        fmt(row.expiration_date),
        fmt(row.current_quantity),
        fmt(row.storage_location),
        fmt(row.status),
        fmt(row.notes),
      ];
    });
  return { headers, rows };
}

export async function exportExperimentalCycles(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("experimental_cycles")
    .select("name,start_date,end_date,status")
    .eq("program_id", programId)
    .order("start_date", { ascending: false, nullsFirst: false });
  const headers = ["Nom du cycle", "Date de début", "Date de fin", "Statut"];
  const rows = (data ?? []).map((r) => [
    fmt(r.name),
    fmt(r.start_date),
    fmt(r.end_date),
    fmt(r.status),
  ]);
  return { headers, rows };
}

export async function exportTasks(
  client: SupabaseClient,
  programId: string,
): Promise<ExportTable> {
  const { data } = await client
    .from("tasks")
    .select(
      "task_code,title,cycle:experimental_cycles!tasks_experimental_cycle_id_fkey(name),planned_date,due_date,zone,priority,status,sop_code,notes",
    )
    .eq("program_id", programId)
    .order("planned_date", { ascending: true, nullsFirst: false });
  const headers = [
    "Task ID",
    "Titre",
    "Cycle expérimental",
    "Date planifiée",
    "Échéance",
    "Zone",
    "Priorité",
    "Statut",
    "Code SOP",
    "Notes",
  ];
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const cycle = row.cycle as { name?: string } | null;
    return [
      fmt(row.task_code),
      fmt(row.title),
      fmt(cycle?.name),
      fmt(row.planned_date),
      fmt(row.due_date),
      fmt(row.zone),
      fmt(row.priority),
      fmt(row.status),
      fmt(row.sop_code),
      fmt(row.notes),
    ];
  });
  return { headers, rows };
}
