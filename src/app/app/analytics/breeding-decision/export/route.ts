import { NextResponse } from "next/server";
import { writeCsv } from "@/lib/import-export/csv";
import { getLatestBreedingDecisionRun } from "../../breeding-decision-actions";

function sanitizeFilenamePart(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export"
  );
}

/** Exports the most recent breeding-decision run for a program/trial -
 * scenario configuration, candidate x trait ranking, selection
 * differentials, and the genetic-validity panel (task review §52).
 * Never exports a secret: the stored run's own specification/result are
 * already the exact size-capped, non-raw-observation summary
 * src/app/app/analytics/breeding-decision-actions.ts persisted. */
export async function GET(request: Request) {
  // getLatestBreedingDecisionRun() below calls requireIdentity() itself
  // and reads through an RLS-scoped client - a run belonging to another
  // organization/program never reaches this point.
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const programId = url.searchParams.get("program");
  const trialId = url.searchParams.get("trial");
  if (!programId || !trialId) {
    return NextResponse.json(
      { error: "Paramètres d’export invalides (programme/essai manquant)." },
      { status: 400 },
    );
  }

  const run = await getLatestBreedingDecisionRun(programId, trialId);
  if (!run) {
    return NextResponse.json(
      {
        error:
          "Aucune analyse de décision d’amélioration à exporter pour cet essai.",
      },
      { status: 404 },
    );
  }

  const filenameBase = sanitizeFilenamePart(
    `breedops-breeding-decision-${trialId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`,
  );

  if (format === "json") {
    const body = JSON.stringify({
      programId,
      trialId,
      scenarioId: run.scenarioId,
      specification: run.specification,
      status: run.status,
      datasetFingerprint: run.datasetFingerprint,
      createdAt: run.createdAt,
      result: run.result,
    });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
      },
    });
  }

  const result = run.result ?? {};
  const candidates = Array.isArray(result.candidates)
    ? (result.candidates as Record<string, unknown>[])
    : [];
  const scoreKey = result.method === "selection_mtsi_v1" ? "mtsi" : "mgidi";
  const headers = ["candidate_id", "rank", "index", "selected"];
  const rows: (string | number | null | undefined)[][] = candidates.map((c) => [
    c.candidate_id as string | number | null | undefined,
    c.rank as string | number | null | undefined,
    c[scoreKey] as string | number | null | undefined,
    c.selected ? "true" : "false",
  ]);
  const csv = writeCsv([headers, ...rows]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
