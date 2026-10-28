"use server";

import { z } from "zod";
import { requireIdentity } from "@/lib/auth";
import { parseCsv, CsvParseError } from "@/lib/import-export/csv";
import { parseXlsxWorkbook, XlsxParseError } from "@/lib/import-export/xlsx";
import {
  IMPORT_LIMITS,
  LimitExceededError,
  assertUploadSize,
} from "@/lib/import-export/limits";
import {
  detectHeaders,
  HeaderError,
  type ColumnMapping,
} from "@/lib/import-export/mapping";
import { previewImport, type RowPreview } from "@/lib/import-export/preview";
import { ENTITY_SPECS, type EntityKey } from "@/lib/import-export/entities";

export type ParsedSheet = {
  name: string;
  headers: string[];
  dataRows: string[][];
};
export type ParseWorkbookResult =
  | { status: "success"; sheets: ParsedSheet[] }
  | { status: "error"; message: string };

const entityKeyValues = [
  "parent_lines",
  "crosses",
  "families",
  "seed_lots",
  "phenotypes",
  "inventory_lots",
  "tasks",
] as const;
// If this list ever drifts from EntityKey, ENTITY_SPECS[entity] below fails to typecheck.
const entityKeySchema = z.enum(entityKeyValues);

/** Step 1-3 of the import flow: load, verify format, detect headers. Writes
 * nothing. The file itself never touches disk — it's parsed in memory and
 * only the resulting rows are kept in the browser for the next step. */
export async function parseWorkbookAction(
  formData: FormData,
): Promise<ParseWorkbookResult> {
  await requireIdentity();
  const file = formData.get("file");
  if (!(file instanceof File))
    return { status: "error", message: "Aucun fichier reçu." };

  try {
    assertUploadSize(file.size);
    const buffer = Buffer.from(await file.arrayBuffer());
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

    const rawSheets = isCsv
      ? [{ name: file.name, rows: parseCsv(buffer.toString("utf8")) }]
      : await parseXlsxWorkbook(buffer, IMPORT_LIMITS);

    const sheets = rawSheets.map((sheet) => {
      const { headers, dataRows } = detectHeaders(sheet.rows);
      if (dataRows.length > IMPORT_LIMITS.maxRows) {
        throw new LimitExceededError(
          `La feuille "${sheet.name}" dépasse ${IMPORT_LIMITS.maxRows} lignes.`,
        );
      }
      if (headers.length > IMPORT_LIMITS.maxColumns) {
        throw new LimitExceededError(
          `La feuille "${sheet.name}" dépasse ${IMPORT_LIMITS.maxColumns} colonnes.`,
        );
      }
      return { name: sheet.name, headers, dataRows };
    });
    return { status: "success", sheets };
  } catch (error) {
    if (
      error instanceof CsvParseError ||
      error instanceof XlsxParseError ||
      error instanceof HeaderError ||
      error instanceof LimitExceededError
    ) {
      return { status: "error", message: error.message };
    }
    console.error("BreedOps import parse failed", error);
    return { status: "error", message: "Le fichier n'a pas pu être lu." };
  }
}

const previewInput = z.object({
  entity: entityKeySchema,
  scopeId: z.string().uuid(),
  mapping: z.record(z.string(), z.number().int().nonnegative().nullable()),
  dataRows: z.array(z.array(z.string())),
});

export type PreviewActionResult =
  | {
      status: "success";
      rows: RowPreview[];
      summary: import("@/lib/import-export/preview").PreviewSummary;
    }
  | { status: "error"; message: string };

/** Steps 4-7: column mapping (already chosen client-side), preview,
 * server-side validation, error display. Entirely read-only — see
 * previewImport's own doc comment for the one known archived-row caveat. */
export async function previewImportAction(
  input: z.infer<typeof previewInput>,
): Promise<PreviewActionResult> {
  const { client, profile } = await requireIdentity();
  const parsed = previewInput.safeParse(input);
  if (!parsed.success)
    return {
      status: "error",
      message: "Requête de prévisualisation invalide.",
    };
  const { entity, scopeId, mapping, dataRows } = parsed.data;

  const spec = ENTITY_SPECS[entity];
  // Inventory is organization-scoped: never let the client pick a different
  // organization than the caller's own, even read-only.
  const effectiveScopeId =
    spec.scope === "organization" ? profile.organization_id : scopeId;

  const { rows, summary } = await previewImport(
    client,
    entity,
    effectiveScopeId,
    dataRows,
    mapping as ColumnMapping,
  );
  return { status: "success", rows, summary };
}

const applyInput = z.object({
  entity: entityKeySchema,
  scopeId: z.string().uuid(),
  rows: z.array(
    z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  ),
});

export type ApplyActionResult =
  | { status: "success"; created: number; updated: number }
  | { status: "error"; message: string };

/** Step 8: transactional apply. Only rows the client believes are CREATE or
 * UPDATE are sent (SKIP/ERROR rows from preview never reach this); the RPC
 * independently re-derives which is which from the business code and
 * aborts the whole call on any row that fails an invariant (migration
 * 000020's import_* functions), so nothing is ever half-applied. */
export async function applyImportAction(
  input: z.infer<typeof applyInput>,
): Promise<ApplyActionResult> {
  const { client, profile } = await requireIdentity();
  const parsed = applyInput.safeParse(input);
  if (!parsed.success)
    return { status: "error", message: "Requête d'import invalide." };
  const { entity, scopeId, rows } = parsed.data;
  if (rows.length === 0)
    return { status: "error", message: "Aucune ligne à importer." };

  const spec = ENTITY_SPECS[entity];
  const effectiveScopeId =
    spec.scope === "organization" ? profile.organization_id : scopeId;
  const payload = rows.map((row, index) => ({ ...row, row_index: index + 1 }));

  const { data, error } = await client.rpc(spec.applyRpc, {
    [spec.scope === "organization"
      ? "target_organization_id"
      : "target_program_id"]: effectiveScopeId,
    rows: payload,
  });
  if (error) {
    console.error("BreedOps import apply failed", {
      entity,
      message: error.message,
    });
    return { status: "error", message: `Import annulé : ${error.message}` };
  }

  const results = (data ?? []) as { status: "created" | "updated" }[];
  const created = results.filter((r) => r.status === "created").length;
  const updated = results.filter((r) => r.status === "updated").length;

  await client.rpc("record_import_export_event", {
    target_organization_id: profile.organization_id,
    target_program_id: spec.scope === "program" ? effectiveScopeId : null,
    event_action: "import",
    target_entity_type: entity,
    resulting_values: { created, updated, total_rows: rows.length },
  });

  return { status: "success", created, updated };
}
