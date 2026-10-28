import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/auth";
import { writeXlsxWorkbook } from "@/lib/import-export/xlsx";
import {
  exportCrosses,
  exportExperimentalCycles,
  exportFamilies,
  exportInventoryLots,
  exportParentLines,
  exportPhenotypes,
  exportSeedLots,
  exportTasks,
} from "@/lib/import-export/export";

const BACKUP_FORMAT_VERSION = "breedops-backup-1";

/** A user-portable business-data bundle, not a PostgreSQL physical backup:
 * every importable entity's current rows for one program (plus the team's
 * inventory), linked by stable business codes, with a metadata sheet
 * recording when/what/which format version. Media binaries are explicitly
 * out of scope for V1 (per the milestone brief); their metadata/path
 * relationships are still recorded, deliberately, in their own sheet so
 * the gap is documented rather than silent. */
export async function GET(request: Request) {
  const { client, profile } = await requireIdentity();
  const url = new URL(request.url);
  const programId = url.searchParams.get("program");
  if (!programId) {
    return NextResponse.json(
      { error: "Un programme est requis pour la sauvegarde." },
      { status: 400 },
    );
  }

  const { data: program } = await client
    .from("programs")
    .select("code,name,created_at")
    .eq("id", programId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!program) {
    return NextResponse.json(
      { error: "Programme introuvable ou inaccessible." },
      { status: 404 },
    );
  }

  const [
    parentLines,
    crosses,
    families,
    seedLots,
    phenotypes,
    inventoryLots,
    cycles,
    tasks,
  ] = await Promise.all([
    exportParentLines(client, programId),
    exportCrosses(client, programId),
    exportFamilies(client, programId),
    exportSeedLots(client, programId),
    exportPhenotypes(client, programId),
    exportInventoryLots(client, profile.organization_id),
    exportExperimentalCycles(client, programId),
    exportTasks(client, programId),
  ]);

  const { data: mediaRows } = await client
    .from("media_assets")
    .select(
      "original_filename,storage_bucket,storage_path,media_kind,caption,parent_line_id,family_id,seed_lot_id,phenotype_evaluation_id,created_at",
    )
    .eq("program_id", programId);

  const metadataRows: (string | number | null)[][] = [
    ["Format", BACKUP_FORMAT_VERSION],
    ["Exporté le", new Date().toISOString()],
    ["Programme", `${program.code} — ${program.name}`],
    [
      "Binaires média inclus",
      "non (métadonnées uniquement, voir la feuille Médias)",
    ],
  ];

  const buffer = await writeXlsxWorkbook([
    { name: "Métadonnées", headers: ["Clé", "Valeur"], rows: metadataRows },
    {
      name: "Lignées parentales",
      headers: parentLines.headers,
      rows: parentLines.rows,
    },
    { name: "Croisements", headers: crosses.headers, rows: crosses.rows },
    { name: "Familles", headers: families.headers, rows: families.rows },
    { name: "Lots de graines", headers: seedLots.headers, rows: seedLots.rows },
    { name: "Phénotypes", headers: phenotypes.headers, rows: phenotypes.rows },
    {
      name: "Inventaire",
      headers: inventoryLots.headers,
      rows: inventoryLots.rows,
    },
    {
      name: "Cycles expérimentaux",
      headers: cycles.headers,
      rows: cycles.rows,
    },
    { name: "Tâches", headers: tasks.headers, rows: tasks.rows },
    {
      name: "Médias (métadonnées)",
      headers: [
        "Fichier",
        "Bucket",
        "Chemin de stockage",
        "Type",
        "Légende",
        "Créé le",
      ],
      rows: (mediaRows ?? []).map((m) => [
        m.original_filename,
        m.storage_bucket,
        m.storage_path,
        m.media_kind,
        m.caption,
        m.created_at,
      ]),
    },
  ]);

  await client.rpc("record_import_export_event", {
    target_organization_id: profile.organization_id,
    target_program_id: programId,
    event_action: "export",
    target_entity_type: "functional_backup",
    resulting_values: { program_code: program.code },
  });

  const filename = `breedops-backup-${program.code.replace(/[^A-Za-z0-9._-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
