import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/auth";
import { writeCsv } from "@/lib/import-export/csv";
import {
  buildObservationDataset,
  listNumericTraits,
} from "@/lib/analytics/dataset";
import { filtersFromFormData } from "../filters";

/** Only [A-Za-z0-9._-] survive; everything else becomes "-" (same
 * convention as src/app/app/import-export/export/route.ts). */
function sanitizeFilenamePart(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export"
  );
}

/** Clean, tidy export of the exact dataset an analysis was built from
 * (task §38/§39): every row a scientist needs to reproduce the analysis in
 * R/Python/JMP/SAS, nothing else - no secrets, no internal auth fields, no
 * arbitrary executable code. */
export async function GET(request: Request) {
  const { client } = await requireIdentity();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";

  let filters;
  try {
    const form = new FormData();
    for (const [key, value] of url.searchParams) form.set(key, value);
    filters = filtersFromFormData(form);
  } catch {
    return NextResponse.json(
      { error: "Paramètres d’analyse invalides." },
      { status: 400 },
    );
  }

  const traits = await listNumericTraits(client, filters.programId);
  const trait = traits.find((t) => t.traitId === filters.traitId);
  if (!trait) {
    return NextResponse.json(
      { error: "Trait introuvable pour ce programme." },
      { status: 404 },
    );
  }

  const dataset = await buildObservationDataset(client, filters, trait);
  const filenameBase = sanitizeFilenamePart(
    `breedops-analytics-${trait.code}-${new Date().toISOString().slice(0, 10)}`,
  );

  if (format === "json") {
    const body = JSON.stringify({
      trait: {
        code: trait.code,
        name: trait.name,
        unit: trait.unit,
        direction: trait.direction,
      },
      specification: filters,
      truncated: dataset.truncated,
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
    "trait_code",
    "trait_name",
    "unit",
    "phenotype_code",
    "family_id",
    "seed_lot_id",
    "block",
    "replicate",
    "location",
    "evaluation_id",
    "evaluation_date",
    "numeric_value",
  ];
  const rows = dataset.rows.map((r) => [
    r.traitCode,
    r.traitName,
    r.unit,
    r.phenotypeCode,
    r.familyId,
    r.seedLotId,
    r.block,
    r.replicate,
    r.location,
    r.evaluationId,
    r.evaluationDate,
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
