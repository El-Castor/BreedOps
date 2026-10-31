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
 * the gap is documented rather than silent. V2-03 added a dedicated
 * "Annotations" sheet so non-destructive overlay annotations never
 * silently disappear from this export either - binaries (the images
 * themselves) remain genuinely absent here and are only ever covered by
 * the separate infrastructure backup (scripts/backup-infra.mjs), which
 * dumps the whole Storage bucket's actual files. */
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

  // Checked and gated BEFORE any data is read — see export/route.ts's
  // matching comment. A system_admin can read a program belonging to a
  // different organization than their own profile (can_access_program
  // bypasses team scoping for system_admin), so the RLS read above is not
  // by itself enough to guarantee the audit pairing below is self-consistent.
  const auditResult = await client.rpc("record_import_export_event", {
    target_organization_id: profile.organization_id,
    target_program_id: programId,
    event_action: "export",
    target_entity_type: "functional_backup",
    resulting_values: { program_code: program.code },
  });
  if (auditResult.error) {
    console.error("BreedOps backup audit event failed", {
      programId,
      message: auditResult.error.message,
    });
    return NextResponse.json(
      { error: "Sauvegarde refusée : portée programme/organisation invalide." },
      { status: 403 },
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
      "id,original_filename,storage_bucket,storage_path,media_kind,caption,captured_at,captured_at_time,developmental_stage,viewpoint,imaging_modality,scale_value,scale_unit,scale_note,scientific_note,parent_line_id,family_id,seed_lot_id,phenotype_evaluation_id,created_at",
    )
    .eq("program_id", programId);

  const mediaIds = (mediaRows ?? []).map((m) => m.id as string);
  const { data: annotationRows } =
    mediaIds.length > 0
      ? await client
          .from("media_annotations")
          .select(
            "media_asset_id,annotation_type,x,y,width,height,label,archived_at,created_at",
          )
          .in("media_asset_id", mediaIds)
      : { data: [] as never[] };

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
        "Date de prise de vue",
        "Heure de prise de vue",
        "Stade de développement",
        "Vue",
        "Modalité d’imagerie",
        "Échelle (valeur)",
        "Échelle (unité)",
        "Référence d’échelle",
        "Note scientifique",
        "Créé le",
      ],
      rows: (mediaRows ?? []).map((m) => [
        m.original_filename,
        m.storage_bucket,
        m.storage_path,
        m.media_kind,
        m.caption,
        m.captured_at,
        m.captured_at_time,
        m.developmental_stage,
        m.viewpoint,
        m.imaging_modality,
        m.scale_value,
        m.scale_unit,
        m.scale_note,
        m.scientific_note,
        m.created_at,
      ]),
    },
    {
      name: "Annotations",
      headers: [
        "Image (chemin de stockage)",
        "Type",
        "X",
        "Y",
        "Largeur",
        "Hauteur",
        "Texte",
        "Archivée",
        "Créée le",
      ],
      rows: (annotationRows ?? []).map((a) => {
        const media = (mediaRows ?? []).find((m) => m.id === a.media_asset_id);
        return [
          media?.storage_path ?? null,
          a.annotation_type,
          a.x,
          a.y,
          a.width,
          a.height,
          a.label,
          a.archived_at ? "oui" : "non",
          a.created_at,
        ];
      }),
    },
  ]);

  const filename = `breedops-backup-${program.code.replace(/[^A-Za-z0-9._-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
