import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pearsonCorrelation, spearmanCorrelation, mean, median } from "./stats";
import { estimateRepeatability } from "./icc";
import { buildObservationDataset, type NumericTraitOption } from "./dataset";
import type {
  AnalyticsFilters,
  EarlyProxyEvidence,
  ObservationRecord,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function daysSinceEpoch(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime() / MS_PER_DAY;
}

/** Per-phenotype mean value and mean observation date within a window.
 * Multiple observations for the same phenotype inside one window are
 * averaged rather than arbitrarily picking one (task §28: BreedOps has no
 * "days after planting" concept, only absolute evaluation_date, so a window
 * is an explicit date range the user chose, and an entity measured several
 * times inside it is summarized, not cherry-picked). */
function summarizeByPhenotype(rows: ObservationRecord[]) {
  const byPhenotype = new Map<
    string,
    { values: number[]; days: number[]; code: string }
  >();
  for (const row of rows) {
    const entry = byPhenotype.get(row.phenotypeId) ?? {
      values: [],
      days: [],
      code: row.phenotypeCode,
    };
    entry.values.push(row.numericValue);
    if (row.evaluationDate) entry.days.push(daysSinceEpoch(row.evaluationDate));
    byPhenotype.set(row.phenotypeId, entry);
  }
  const summary = new Map<string, { value: number; day: number | null }>();
  for (const [phenotypeId, entry] of byPhenotype) {
    summary.set(phenotypeId, {
      value: mean(entry.values),
      day: entry.days.length ? mean(entry.days) : null,
    });
  }
  return summary;
}

export async function computeEarlyProxyEvidence(
  client: SupabaseClient,
  filters: AnalyticsFilters,
  source: { trait: NumericTraitOption; from: string; to: string },
  target: { trait: NumericTraitOption; from: string; to: string },
): Promise<EarlyProxyEvidence> {
  const sourceDataset = await buildObservationDataset(
    client,
    {
      ...filters,
      traitId: source.trait.traitId,
      dateFrom: source.from,
      dateTo: source.to,
    },
    source.trait,
  );
  const targetDataset = await buildObservationDataset(
    client,
    {
      ...filters,
      traitId: target.trait.traitId,
      dateFrom: target.from,
      dateTo: target.to,
    },
    target.trait,
  );

  const sourceSummary = summarizeByPhenotype(sourceDataset.rows);
  const targetSummary = summarizeByPhenotype(targetDataset.rows);

  const xs: number[] = [];
  const ys: number[] = [];
  const dayGaps: number[] = [];
  for (const [phenotypeId, sourceEntry] of sourceSummary) {
    const targetEntry = targetSummary.get(phenotypeId);
    if (!targetEntry) continue;
    xs.push(sourceEntry.value);
    ys.push(targetEntry.value);
    if (sourceEntry.day != null && targetEntry.day != null) {
      dayGaps.push(targetEntry.day - sourceEntry.day);
    }
  }

  const pearson = pearsonCorrelation(xs, ys);
  const spearman = spearmanCorrelation(xs, ys);

  const sourceGroups = new Map<string, number[]>();
  for (const row of sourceDataset.rows) {
    const list = sourceGroups.get(row.phenotypeId) ?? [];
    list.push(row.numericValue);
    sourceGroups.set(row.phenotypeId, list);
  }
  const repeatability =
    sourceGroups.size > 0
      ? estimateRepeatability([...sourceGroups.values()])
      : null;

  const sourceEntityCount = sourceSummary.size;
  const missingPct =
    sourceEntityCount > 0 ? 1 - xs.length / sourceEntityCount : 0;

  return {
    sourceTraitId: source.trait.traitId,
    sourceTraitName: source.trait.name,
    sourceWindow: { from: source.from, to: source.to },
    targetTraitId: target.trait.traitId,
    targetTraitName: target.trait.name,
    targetWindow: { from: target.from, to: target.to },
    pairedN: xs.length,
    medianDaysEarlier: dayGaps.length ? median(dayGaps) : null,
    pearsonR: pearson?.r ?? null,
    spearmanRho: spearman?.r ?? null,
    repeatability,
    missingPct,
  };
}
