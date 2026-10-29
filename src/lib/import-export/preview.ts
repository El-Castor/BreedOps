import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRowPayload, type ColumnMapping } from "./mapping";
import { ENTITY_SPECS, type EntityKey } from "./entities";

export type RowStatus = "valid" | "warning" | "error";
export type RowOperation = "create" | "update" | "skip" | null;

export type RowPreview = {
  rowIndex: number;
  status: RowStatus;
  operation: RowOperation;
  code: string | null;
  payload: Record<string, string | number | null>;
  messages: string[];
};

export type PreviewSummary = {
  total: number;
  valid: number;
  warning: number;
  error: number;
  create: number;
  update: number;
  skip: number;
};

function summarize(rows: RowPreview[]): PreviewSummary {
  const summary: PreviewSummary = {
    total: rows.length,
    valid: 0,
    warning: 0,
    error: 0,
    create: 0,
    update: 0,
    skip: 0,
  };
  for (const row of rows) {
    summary[row.status] += 1;
    if (row.operation) summary[row.operation] += 1;
  }
  return summary;
}

/** Finds a business code repeated across rows of the SAME file batch — a
 * conflict the database can't see until two rows are compared to each
 * other, not just to what's already stored. */
function duplicateCodesInFile(
  rows: { rowIndex: number; code: string | null }[],
): Map<number, string> {
  const seenAt = new Map<string, number>();
  const duplicateMessage = new Map<number, string>();
  for (const row of rows) {
    if (!row.code) continue;
    const firstIndex = seenAt.get(row.code);
    if (firstIndex !== undefined) {
      duplicateMessage.set(
        row.rowIndex,
        `Code en double dans le fichier (déjà utilisé à la ligne ${firstIndex}).`,
      );
    } else {
      seenAt.set(row.code, row.rowIndex);
    }
  }
  return duplicateMessage;
}

async function resolveReference(
  client: SupabaseClient,
  targetEntity: EntityKey | "experimental_cycles",
  scopeId: string,
  value: string,
): Promise<{ found: boolean; archived: boolean }> {
  if (targetEntity === "experimental_cycles") {
    const { data } = await client
      .from("experimental_cycles")
      .select("id")
      .eq("program_id", scopeId)
      .eq("name", value)
      .is("deleted_at", null)
      .maybeSingle();
    return { found: Boolean(data), archived: false };
  }
  const spec = ENTITY_SPECS[targetEntity];
  if (!spec.codeField) return { found: false, archived: false };
  const scopeColumn =
    spec.scope === "program" ? "program_id" : "organization_id";
  const { data } = await client
    .from(spec.table)
    .select("id")
    .eq(scopeColumn, scopeId)
    .eq(spec.codeField, value)
    .is("deleted_at", null)
    .maybeSingle();
  return { found: Boolean(data), archived: false };
}

/** Read-only classification of every row of one entity's batch before Apply
 * is ever offered. Mirrors the matching RPC's own resolution order exactly,
 * so a row preview marks VALID should normally apply cleanly — but RLS read
 * policies filter archived rows (deleted_at IS NULL) for every entity here,
 * while the apply RPCs are SECURITY DEFINER and see everything, so this
 * cannot detect "the matching code exists but is archived" the way apply
 * authoritatively does. That specific case surfaces as a clear per-row
 * error at Apply time instead of at Preview time — documented, not silent. */
export async function previewImport(
  client: SupabaseClient,
  entityKey: EntityKey,
  scopeId: string,
  rawRows: string[][],
  mapping: ColumnMapping,
): Promise<{ rows: RowPreview[]; summary: PreviewSummary }> {
  const spec = ENTITY_SPECS[entityKey];
  const scopeColumn =
    spec.scope === "program" ? "program_id" : "organization_id";

  const built = rawRows.map((rawRow, index) => {
    const { payload, errors } = buildRowPayload(spec, mapping, rawRow);
    const code = spec.codeField
      ? (payload[spec.codeField] as string | null)
      : null;
    return { rowIndex: index + 1, payload, errors, code };
  });

  const duplicates = duplicateCodesInFile(built);

  const rows: RowPreview[] = [];
  for (const row of built) {
    const messages: string[] = row.errors.map((e) => e.message);
    const duplicateMessage = duplicates.get(row.rowIndex);
    if (duplicateMessage) messages.push(duplicateMessage);

    let existing: Record<string, unknown> | null = null;
    if (row.code && spec.codeField) {
      const { data } = await client
        .from(spec.table)
        .select("*")
        .eq(scopeColumn, scopeId)
        .eq(spec.codeField, row.code)
        .maybeSingle();
      existing = data;
    }

    for (const reference of spec.references) {
      const value = row.payload[reference.key] as string | null;
      if (!value) {
        if (reference.requiredOnCreate && !existing) {
          messages.push(
            `${reference.label} est requis pour créer une nouvelle ligne.`,
          );
        }
        continue;
      }
      const resolution = await resolveReference(
        client,
        reference.targetEntity,
        scopeId,
        value,
      );
      if (!resolution.found) {
        messages.push(
          `${reference.label} "${value}" introuvable dans ce programme.`,
        );
      } else if (existing && reference.key in existing === false) {
        // immutability is re-checked authoritatively by the apply RPC;
        // preview only flags an unresolved reference here.
      }
    }

    // Special-cased because its natural key is (item name, batch number),
    // not a single generated business code like every other entity.
    if (entityKey === "inventory_lots") {
      const itemName = row.payload.item_name as string | null;
      if (itemName) {
        const { data: matches } = await client
          .from("inventory_items")
          .select("id,name")
          .eq("organization_id", scopeId)
          .is("deleted_at", null)
          .ilike("name", itemName);
        const exact = (matches ?? []).filter(
          (m) => m.name.toLowerCase() === itemName.toLowerCase(),
        );
        if (exact.length === 0)
          messages.push(
            `Article "${itemName}" introuvable (aucune correspondance approximative).`,
          );
        else if (exact.length > 1)
          messages.push(
            `Article "${itemName}" ambigu (plusieurs articles portent ce nom).`,
          );
      }
    }

    let operation: RowOperation = null;
    let status: RowStatus = "valid";

    if (row.errors.length > 0 || duplicateMessage) {
      status = "error";
    } else if (messages.length > 0) {
      status = "error"; // unresolved/missing references are blocking, not warnings
    } else if (existing) {
      operation = "update";
    } else {
      const missingRequired = spec.fields
        .filter((f) => f.requiredOnCreate && !row.payload[f.key])
        .map((f) => f.label);
      if (missingRequired.length > 0) {
        status = "error";
        messages.push(
          `Champs requis manquants pour la création : ${missingRequired.join(", ")}.`,
        );
      } else {
        operation = "create";
      }
    }

    rows.push({
      rowIndex: row.rowIndex,
      status,
      operation,
      code: row.code,
      payload: row.payload,
      messages,
    });
  }

  return { rows, summary: summarize(rows) };
}
