import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/auth";
import { ENTITY_SPECS, type EntityKey } from "@/lib/import-export/entities";
import { writeCsv } from "@/lib/import-export/csv";
import { writeXlsxWorkbook } from "@/lib/import-export/xlsx";
import {
  exportCrosses,
  exportFamilies,
  exportInventoryLots,
  exportParentLines,
  exportPhenotypes,
  exportSeedLots,
  exportTasks,
  type ExportTable,
} from "@/lib/import-export/export";

const EXPORTERS: Partial<
  Record<
    EntityKey,
    (
      client: Awaited<ReturnType<typeof requireIdentity>>["client"],
      scopeId: string,
    ) => Promise<ExportTable>
  >
> = {
  parent_lines: exportParentLines,
  crosses: exportCrosses,
  families: exportFamilies,
  seed_lots: exportSeedLots,
  phenotypes: exportPhenotypes,
  inventory_lots: exportInventoryLots,
  tasks: exportTasks,
};

/** Only [A-Za-z0-9._-] survive; everything else becomes "-", preventing any
 * path traversal or header-injection attempt via a crafted entity/program
 * value from reaching a Content-Disposition header. */
function sanitizeFilenamePart(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export"
  );
}

export async function GET(request: Request) {
  const { client, profile } = await requireIdentity();
  const url = new URL(request.url);
  const entityParam = url.searchParams.get("entity");
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const programId = url.searchParams.get("program");

  const entity = entityParam as EntityKey;
  const spec = entity ? ENTITY_SPECS[entity] : undefined;
  const exporter = entity ? EXPORTERS[entity] : undefined;
  if (!spec || !exporter) {
    return NextResponse.json(
      { error: "Entité d'export inconnue." },
      { status: 400 },
    );
  }
  if (spec.scope === "program" && !programId) {
    return NextResponse.json(
      { error: "Un programme est requis pour cet export." },
      { status: 400 },
    );
  }
  const scopeId =
    spec.scope === "organization"
      ? profile.organization_id
      : (programId as string);

  // Checked and gated BEFORE any data is read: record_import_export_event
  // independently proves the program (when there is one) actually belongs
  // to the caller's own organization (migration 000021). Without this
  // ordering, a forged/foreign program_id would simply return zero rows
  // through RLS — an "apparently valid" empty export — while still logging
  // an audit record pairing the caller's real organization with a program
  // that was never actually theirs. Checking first means that mismatch is
  // rejected outright instead of silently producing both artifacts.
  const auditResult = await client.rpc("record_import_export_event", {
    target_organization_id: profile.organization_id,
    target_program_id: spec.scope === "program" ? scopeId : null,
    event_action: "export",
    target_entity_type: entity,
    resulting_values: { format },
  });
  if (auditResult.error) {
    console.error("BreedOps export audit event failed", {
      entity,
      message: auditResult.error.message,
    });
    return NextResponse.json(
      { error: "Export refusé : portée programme/organisation invalide." },
      { status: 403 },
    );
  }

  const table = await exporter(client, scopeId);
  const filenameBase = sanitizeFilenamePart(
    `breedops-${entity}-${new Date().toISOString().slice(0, 10)}`,
  );

  if (format === "xlsx") {
    const buffer = await writeXlsxWorkbook([
      {
        name: spec.label.slice(0, 31),
        headers: table.headers,
        rows: table.rows,
      },
    ]);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  }

  const csv = writeCsv([table.headers, ...table.rows]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
