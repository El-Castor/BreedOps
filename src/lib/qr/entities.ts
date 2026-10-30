import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { isQrEntityType, isUuid, type QrEntityType } from "./payload";

type DbClient = Awaited<ReturnType<typeof createClient>>;

export type QrResolvedEntity = {
  type: QrEntityType;
  id: string;
  code: string | null;
  title: string;
  subtitle: string | null;
  status: string | null;
  archived: boolean;
  registryHref: string;
};

function registryHref(
  base: "/app/breeding" | "/app/inventory",
  params: Record<string, string>,
): string {
  const search = new URLSearchParams(params).toString();
  return search ? `${base}?${search}` : base;
}

// Every resolver queries through the caller's own RLS-scoped client - the
// exact same client requireIdentity() returns for every other page in this
// app. Authorization is never re-implemented here: a row this caller cannot
// access simply never comes back, indistinguishable from a row that does
// not exist (see src/app/app/lookup/page.tsx for why that is deliberate -
// it avoids leaking cross-team/cross-program existence via enumeration).
//
// Archived-row behavior matches each table's own current RLS policy
// exactly (see agend.md V2-01 for the detailed audit): breeding entities
// (migration 000014) and equipment (migration 000022) keep archived rows
// readable, so this resolver surfaces them with archived: true rather than
// treating them as missing; inventory_items/inventory_lots (policy
// unchanged since migration 000003) still filter deleted_at at the RLS
// layer, so an archived one already comes back as "no row" here, matching
// the fact that the Inventory page has no "show archived" toggle either.
async function resolveParent(client: DbClient, id: string) {
  const { data } = await client
    .from("parent_lines")
    .select("id,parent_code,line_name,status,program_id,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const archived = Boolean(data.deleted_at);
  return {
    type: "parent" as const,
    id: data.id,
    code: data.parent_code,
    title: data.line_name || data.parent_code,
    subtitle: null,
    status: data.status,
    archived,
    registryHref: registryHref("/app/breeding", {
      program: data.program_id,
      q: data.parent_code,
      ...(archived ? { archived: "1" } : {}),
    }),
  };
}

async function resolveCross(client: DbClient, id: string) {
  const { data } = await client
    .from("crosses")
    .select("id,cross_code,generation,status,program_id,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const archived = Boolean(data.deleted_at);
  return {
    type: "cross" as const,
    id: data.id,
    code: data.cross_code,
    title: data.cross_code,
    subtitle: data.generation != null ? `Génération ${data.generation}` : null,
    status: data.status,
    archived,
    registryHref: registryHref("/app/breeding", {
      program: data.program_id,
      q: data.cross_code,
      ...(archived ? { archived: "1" } : {}),
    }),
  };
}

async function resolveFamily(client: DbClient, id: string) {
  const { data } = await client
    .from("families")
    .select("id,family_code,generation,status,program_id,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const archived = Boolean(data.deleted_at);
  return {
    type: "family" as const,
    id: data.id,
    code: data.family_code,
    title: data.family_code,
    subtitle: data.generation != null ? `Génération ${data.generation}` : null,
    status: data.status,
    archived,
    registryHref: registryHref("/app/breeding", {
      program: data.program_id,
      q: data.family_code,
      ...(archived ? { archived: "1" } : {}),
    }),
  };
}

async function resolveSeedLot(client: DbClient, id: string) {
  const { data } = await client
    .from("seed_lots")
    .select("id,seed_lot_code,storage_location,status,program_id,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const archived = Boolean(data.deleted_at);
  return {
    type: "seed_lot" as const,
    id: data.id,
    code: data.seed_lot_code,
    title: data.seed_lot_code,
    subtitle: data.storage_location,
    status: data.status,
    archived,
    registryHref: registryHref("/app/breeding", {
      program: data.program_id,
      q: data.seed_lot_code,
      ...(archived ? { archived: "1" } : {}),
    }),
  };
}

async function resolveInventoryItem(client: DbClient, id: string) {
  const { data } = await client
    .from("inventory_items")
    .select("id,name,category,is_active,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    type: "inventory_item" as const,
    id: data.id,
    code: null,
    title: data.name,
    subtitle: data.category,
    status: data.is_active ? "Actif" : "Inactif",
    archived: Boolean(data.deleted_at),
    registryHref: registryHref("/app/inventory", {}),
  };
}

async function resolveInventoryLot(client: DbClient, id: string) {
  const { data } = await client
    .from("inventory_lots")
    .select(
      "id,batch_number,storage_location,status,deleted_at,inventory_item_id,inventory_items(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const itemName = Array.isArray(data.inventory_items)
    ? data.inventory_items[0]?.name
    : (data.inventory_items as { name?: string } | null)?.name;
  return {
    type: "inventory_lot" as const,
    id: data.id,
    code: null,
    title: [itemName, data.batch_number].filter(Boolean).join(" · "),
    subtitle: data.storage_location,
    status: data.status,
    archived: Boolean(data.deleted_at),
    registryHref: registryHref("/app/inventory", {
      ...(data.batch_number ? { q: data.batch_number } : {}),
    }),
  };
}

async function resolveEquipment(client: DbClient, id: string) {
  const { data } = await client
    .from("equipment")
    .select("id,name,serial_number,location,operational_status,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    type: "equipment" as const,
    id: data.id,
    code: null,
    title: data.name,
    subtitle: data.serial_number,
    status: data.operational_status,
    archived: Boolean(data.deleted_at),
    registryHref: registryHref("/app/inventory", {
      ...(data.serial_number ? { eq: data.serial_number } : {}),
    }),
  };
}

const RESOLVERS: Record<
  QrEntityType,
  (client: DbClient, id: string) => Promise<QrResolvedEntity | null>
> = {
  parent: resolveParent,
  cross: resolveCross,
  family: resolveFamily,
  seed_lot: resolveSeedLot,
  inventory_item: resolveInventoryItem,
  inventory_lot: resolveInventoryLot,
  equipment: resolveEquipment,
};

// Manual fallback for a damaged/unreadable QR code (requirement: a damaged
// QR must never make an entity inaccessible). Only the 4 breeding entity
// types have a real, globally unique business code a person could type in
// by hand; inventory items/lots and equipment are already searchable by
// name/batch/serial from their own registry page (/app/inventory), so this
// does not duplicate that. Tries each business-code column in turn and
// returns the first RLS-visible match, or null.
const CODE_LOOKUPS: {
  type: Extract<QrEntityType, "parent" | "cross" | "family" | "seed_lot">;
  table: string;
  column: string;
}[] = [
  { type: "parent", table: "parent_lines", column: "parent_code" },
  { type: "cross", table: "crosses", column: "cross_code" },
  { type: "family", table: "families", column: "family_code" },
  { type: "seed_lot", table: "seed_lots", column: "seed_lot_code" },
];

export async function resolveQrEntityByCode(
  client: DbClient,
  rawCode: unknown,
): Promise<QrResolvedEntity | null> {
  if (typeof rawCode !== "string") return null;
  const code = rawCode.trim();
  if (!code || code.length > 120) return null;
  for (const lookup of CODE_LOOKUPS) {
    const { data } = await client
      .from(lookup.table)
      .select("id")
      .eq(lookup.column, code)
      .maybeSingle();
    if (data) return RESOLVERS[lookup.type](client, data.id);
  }
  return null;
}

// The single entry point every QR-driven surface must use. Rejects anything
// not on the strict allowlist or not a well-formed UUID before ever
// touching the database - malformed input and an unsupported type both
// resolve to null, exactly like a genuinely missing/unauthorized row, so
// none of these cases can be told apart from the outside.
export async function resolveQrEntity(
  client: DbClient,
  type: unknown,
  id: unknown,
): Promise<QrResolvedEntity | null> {
  if (!isQrEntityType(type) || !isUuid(id)) return null;
  return RESOLVERS[type](client, id);
}
