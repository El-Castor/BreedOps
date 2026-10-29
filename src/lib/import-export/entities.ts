/** The canonical, config-driven registry of every importable/exportable
 * BreedOps entity. One spec per entity drives column mapping, preview,
 * validation and apply uniformly — see docs/import-export.md for the design.
 * Field keys here are exactly the JSON keys the matching `import_*` Postgres
 * function (migration 000020) reads; never add a field here without adding
 * it to the function, and vice versa. */

export type FieldType = "text" | "integer" | "numeric" | "date" | "enum";

export type EntityField = {
  key: string;
  label: string;
  type: FieldType;
  /** Required to CREATE a new row (never required to UPDATE an existing one). */
  requiredOnCreate: boolean;
  /** An identity/provenance field: changing it on an existing row is a
   * conflict, never a silent update. */
  immutable: boolean;
  enumValues?: readonly string[];
  maxLength?: number;
};

export type ReferenceField = {
  /** The column key in this entity's rows that holds the *other* entity's
   * business code (e.g. "female_parent_code" on crosses). */
  key: string;
  label: string;
  /** The other entity's registry key, or a lookup-only target that isn't
   * itself importable in V1 (e.g. "experimental_cycles", resolved by name
   * rather than a generated business code). */
  targetEntity: EntityKey | "experimental_cycles";
  requiredOnCreate: boolean;
};

export type EntityKey =
  | "parent_lines"
  | "crosses"
  | "families"
  | "seed_lots"
  | "phenotypes"
  | "inventory_lots"
  | "tasks";

export type EntitySpec = {
  key: EntityKey;
  label: string;
  /** PROMPT.md §12's own name for this business-code idempotency key. */
  businessCodeLabel: string;
  /** The row field holding this entity's own business code (null for
   * inventory_lots, whose natural key is item + batch_number, not a single
   * generated code). */
  codeField: string | null;
  /** Postgres table name, for preview queries. */
  table: string;
  /** The `import_*` RPC name (migration 000020). */
  applyRpc: string;
  /** "program" (program_id) or "organization" (organization_id) — which
   * scope id the RPC and preview queries take. */
  scope: "program" | "organization";
  references: ReferenceField[];
  fields: EntityField[];
};

const notes: EntityField = {
  key: "notes",
  label: "Notes",
  type: "text",
  requiredOnCreate: false,
  immutable: false,
  maxLength: 2000,
};

export const ENTITY_SPECS: Record<EntityKey, EntitySpec> = {
  parent_lines: {
    key: "parent_lines",
    label: "Lignées parentales",
    businessCodeLabel: "Parent ID",
    codeField: "parent_code",
    table: "parent_lines",
    applyRpc: "import_parent_lines",
    scope: "program",
    references: [],
    fields: [
      {
        key: "parent_code",
        label: "Code (Parent ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "line_name",
        label: "Nom",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
        maxLength: 200,
      },
      {
        key: "generation",
        label: "Génération",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "origin",
        label: "Origine",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "accession",
        label: "Accession",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
        maxLength: 120,
      },
      {
        key: "source",
        label: "Source",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
        maxLength: 160,
      },
      notes,
    ],
  },
  crosses: {
    key: "crosses",
    label: "Croisements",
    businessCodeLabel: "Cross ID",
    codeField: "cross_code",
    table: "crosses",
    applyRpc: "import_crosses",
    scope: "program",
    references: [
      {
        key: "female_parent_code",
        label: "Parent femelle (Parent ID)",
        targetEntity: "parent_lines",
        requiredOnCreate: true,
      },
      {
        key: "male_parent_code",
        label: "Parent mâle (Parent ID)",
        targetEntity: "parent_lines",
        requiredOnCreate: true,
      },
    ],
    fields: [
      {
        key: "cross_code",
        label: "Code (Cross ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "generation",
        label: "Génération",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "target_traits",
        label: "Caractères ciblés",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "pollination_date",
        label: "Date de pollinisation",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "harvest_date",
        label: "Date de récolte",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "pollinated_units",
        label: "Unités pollinisées",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "established_units",
        label: "Unités établies",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "total_seeds",
        label: "Graines totales",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "priority",
        label: "Priorité",
        type: "enum",
        requiredOnCreate: false,
        immutable: false,
        enumValues: ["low", "medium", "high"],
      },
      notes,
    ],
  },
  families: {
    key: "families",
    label: "Familles",
    businessCodeLabel: "Family ID",
    codeField: "family_code",
    table: "families",
    applyRpc: "import_families",
    scope: "program",
    references: [
      {
        key: "cross_code",
        label: "Croisement (Cross ID)",
        targetEntity: "crosses",
        requiredOnCreate: true,
      },
    ],
    fields: [
      {
        key: "family_code",
        label: "Code (Family ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "generation",
        label: "Génération",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      notes,
    ],
  },
  seed_lots: {
    key: "seed_lots",
    label: "Lots de graines",
    businessCodeLabel: "Seed Lot ID",
    codeField: "seed_lot_code",
    table: "seed_lots",
    applyRpc: "import_seed_lots",
    scope: "program",
    references: [
      {
        key: "cross_code",
        label: "Croisement (Cross ID)",
        targetEntity: "crosses",
        requiredOnCreate: false,
      },
      {
        key: "family_code",
        label: "Famille (Family ID)",
        targetEntity: "families",
        requiredOnCreate: false,
      },
    ],
    fields: [
      {
        key: "seed_lot_code",
        label: "Code (Seed Lot ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "harvest_date",
        label: "Date de récolte",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "total_quantity",
        label: "Quantité totale",
        type: "numeric",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "quantity_unit",
        label: "Unité",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "storage_location",
        label: "Emplacement",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "genetic_purity_status",
        label: "Pureté génétique",
        type: "enum",
        requiredOnCreate: false,
        immutable: false,
        enumValues: ["unknown", "pending", "verified", "failed"],
      },
      {
        key: "verification_method",
        label: "Méthode de vérification",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      notes,
    ],
  },
  phenotypes: {
    key: "phenotypes",
    label: "Phénotypes",
    businessCodeLabel: "Phenotype ID",
    codeField: "phenotype_code",
    table: "phenotypes",
    applyRpc: "import_phenotypes",
    scope: "program",
    references: [
      {
        key: "family_code",
        label: "Famille (Family ID)",
        targetEntity: "families",
        requiredOnCreate: true,
      },
      {
        key: "seed_lot_code",
        label: "Lot de graines (Seed Lot ID)",
        targetEntity: "seed_lots",
        requiredOnCreate: false,
      },
    ],
    fields: [
      {
        key: "phenotype_code",
        label: "Code (Phenotype ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "block",
        label: "Bloc",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "replicate",
        label: "Répétition",
        type: "integer",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "location",
        label: "Emplacement",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      notes,
    ],
  },
  inventory_lots: {
    key: "inventory_lots",
    label: "Lots d'inventaire",
    businessCodeLabel: "Lot Number",
    codeField: "batch_number",
    table: "inventory_lots",
    applyRpc: "import_inventory_lots",
    scope: "organization",
    references: [],
    fields: [
      {
        key: "item_name",
        label: "Article (nom exact)",
        type: "text",
        requiredOnCreate: true,
        immutable: true,
      },
      {
        key: "batch_number",
        label: "N° de lot (Lot Number)",
        type: "text",
        requiredOnCreate: true,
        immutable: true,
      },
      {
        key: "received_at",
        label: "Date de réception",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "expiration_date",
        label: "Date de péremption",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "initial_quantity",
        label: "Quantité initiale (création uniquement)",
        type: "numeric",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "storage_location",
        label: "Emplacement",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      notes,
    ],
  },
  tasks: {
    key: "tasks",
    label: "Tâches",
    businessCodeLabel: "Task ID",
    codeField: "task_code",
    table: "tasks",
    applyRpc: "import_tasks",
    scope: "program",
    references: [
      {
        key: "cycle_name",
        label: "Cycle expérimental (nom)",
        targetEntity: "experimental_cycles",
        requiredOnCreate: true,
      },
    ],
    fields: [
      {
        key: "task_code",
        label: "Code (Task ID)",
        type: "text",
        requiredOnCreate: false,
        immutable: true,
      },
      {
        key: "title",
        label: "Titre",
        type: "text",
        requiredOnCreate: true,
        immutable: false,
        maxLength: 200,
      },
      {
        key: "description",
        label: "Description",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "planned_date",
        label: "Date planifiée",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "due_date",
        label: "Date d'échéance",
        type: "date",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "zone",
        label: "Zone",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "priority",
        label: "Priorité",
        type: "enum",
        requiredOnCreate: false,
        immutable: false,
        enumValues: ["low", "medium", "high"],
      },
      {
        key: "sop_code",
        label: "Code SOP",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      {
        key: "expected_deliverable",
        label: "Livrable attendu",
        type: "text",
        requiredOnCreate: false,
        immutable: false,
      },
      notes,
    ],
  },
};

/** The dependency-respecting order a multi-entity import must apply in.
 * Matches PROMPT.md §12/§9: breeding chain first, inventory and tasks are
 * independent of it and of each other. */
export const IMPORT_ENTITY_ORDER: EntityKey[] = [
  "parent_lines",
  "crosses",
  "families",
  "seed_lots",
  "phenotypes",
  "inventory_lots",
  "tasks",
];

export function entitySpec(key: EntityKey): EntitySpec {
  return ENTITY_SPECS[key];
}
