import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/auth";
import { writeCsv } from "@/lib/import-export/csv";
import { buildMetObservationDataset } from "@/lib/met/dataset";

/** Only [A-Za-z0-9._-] survive; everything else becomes "-" (same
 * convention as src/app/app/analytics/export/route.ts and
 * src/app/app/import-export/export/route.ts). */
function sanitizeFilenamePart(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export"
  );
}

/** Sibling of src/app/app/analytics/export/route.ts for the multi-
 * environment dataset (B42): a clean export of the exact Entry x
 * Environment observations behind a MET analysis, reusing the same
 * canonical dataset builder the analysis page and R engine are built
 * from - never a separately-derived export query. */
export async function GET(request: Request) {
  const { client } = await requireIdentity();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const trialId = url.searchParams.get("trial");
  const traitId = url.searchParams.get("trait");
  const evaluationDate = url.searchParams.get("occasion");
  if (!trialId || !traitId) {
    return NextResponse.json(
      { error: "Paramètres d’export invalides (essai/trait manquant)." },
      { status: 400 },
    );
  }

  const dataset = await buildMetObservationDataset(client, {
    trialId,
    traitId,
    includeArchived: url.searchParams.get("archived") === "1",
    evaluationDate,
  });
  // Same rule as the V2-04 export: exporting a truncated preview would hand
  // the scientist an incomplete dataset while implying it is complete.
  if (dataset.tooLarge) {
    return NextResponse.json(
      {
        error:
          "Le jeu de données de cet essai dépasse la taille d’export prise en charge.",
      },
      { status: 413 },
    );
  }
  if (dataset.rows.length === 0) {
    return NextResponse.json(
      { error: "Aucune observation à exporter pour cet essai/trait." },
      { status: 404 },
    );
  }

  const filenameBase = sanitizeFilenamePart(
    `breedops-met-${trialId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`,
  );

  if (format === "json") {
    const body = JSON.stringify({
      trialId,
      traitId,
      evaluationDate,
      rows: dataset.rows,
    });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
      },
    });
  }

  const headers = [
    "entry_code",
    "entry_label",
    "entry_scientific_role",
    "environment_code",
    "site_code",
    "campaign",
    "block",
    "evaluation_date",
    "phenotype_code",
    "numeric_value",
  ];
  const rows = dataset.rows.map((r) => [
    r.entryCode,
    r.entryLabel,
    r.entryScientificRole,
    r.environmentCode,
    r.siteCode,
    r.campaign,
    r.block,
    r.evaluationDate,
    r.phenotypeCode,
    r.numericValue,
  ]);
  const csv = writeCsv([headers, ...rows]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
