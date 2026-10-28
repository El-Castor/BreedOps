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
