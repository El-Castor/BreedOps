// Pure function only (no DB/network access) - no "server-only" guard, same
// convention as design-summary.ts/eligibility.ts, so it stays directly
// unit-testable.
//
// Entry x Environment rank-stability/crossover analysis (B20-B25): the
// environment-pair sibling of buildRankStability's time-pair analysis in
// src/lib/analytics/analysis.ts, reusing the SAME spearmanCorrelation
// primitive rather than a second implementation. Operates on raw observed
// means per entry x environment cell, independent of (and complementary
// to) the R mixed-model BLUPs - a crossover finding here does not depend
// on met_base_v1 having been run at all.
import { spearmanCorrelation } from "../analytics/stats";
import type { MetObservationRecord } from "./types";

/** The statistical floor for any Spearman correlation at all
 * (spearmanCorrelation itself refuses below n=3). This is deliberately
 * NOT the MIN_RANK_STABILITY_PAIRED_N=8 used for V2-04's longitudinal
 * timepoint pairs: a MET trial's entry count is typically much smaller
 * than the number of phenotyped individuals a longitudinal comparison
 * draws from, so reusing that threshold here would mark most real, valid
 * MET trials as "insufficient" by construction. */
export const MIN_SHARED_ENTRIES_FOR_RANK_PAIR = 3;

/** Caps the number of environments compared pairwise (O(n^2) pairs and
 * payload size), keeping the environments with the most entries sampled
 * when there are more than this - same selection rule as
 * MAX_RANK_STABILITY_TIMEPOINTS in src/lib/analytics/eligibility.ts, which
 * this is also deliberately NOT reusing verbatim: a MET trial's own
 * environment count is the central object of the analysis (unlike a
 * longitudinal series' incidental timepoint count), so a more generous cap
 * is used. */
export const MAX_RANK_STABILITY_ENVIRONMENTS = 15;

export type EnvironmentRankPair = {
  environmentIdA: string;
  environmentIdB: string;
  pairedN: number;
  rho: number | null;
  insufficientN?: boolean;
  /** The single best-performing entry (by mean observed value) in each
   * environment. A literal, non-arbitrary crossover signal: whether the
   * top entry itself changes between the two environments - deliberately
   * not a threshold on `rho` (B3: never fabricate a categorical judgment
   * from an arbitrary cutoff when a direct signal is available). */
  topEntryA: string;
  topEntryB: string;
  topEntryChanged: boolean;
};

/** Mean observed value per entry, per environment - averaging over
 * replicates/blocks within the same entry x environment cell, exactly the
 * granularity every MET model (met_base_v1/met_ammi_v1/met_waasb_v1) is
 * itself fit at. */
function entryMeansByEnvironment(
  rows: MetObservationRecord[],
): Map<string, Map<string, number>> {
  const sums = new Map<string, Map<string, { total: number; count: number }>>();
  for (const row of rows) {
    const envMap = sums.get(row.environmentId) ?? new Map();
    const entry = envMap.get(row.entryId) ?? { total: 0, count: 0 };
    entry.total += row.numericValue;
    entry.count += 1;
    envMap.set(row.entryId, entry);
    sums.set(row.environmentId, envMap);
  }
  const means = new Map<string, Map<string, number>>();
  for (const [envId, envMap] of sums) {
    const entryMeans = new Map<string, number>();
    for (const [entryId, { total, count }] of envMap) {
      entryMeans.set(entryId, total / count);
    }
    means.set(envId, entryMeans);
  }
  return means;
}

function topEntry(entryMeans: Map<string, number>): string {
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const [entryId, value] of entryMeans) {
    if (value > bestValue) {
      bestValue = value;
      best = entryId;
    }
  }
  // entryMeans is only ever built from non-empty rows, so this is safe.
  return best as string;
}

/** Every pairwise Entry x Environment rank comparison, built from the SAME
 * fetched dataset the eligibility engine and the R models use - never a
 * second, independent query. Reports every pair (never silently drops
 * one): a pair with too few shared entries gets `insufficientN: true` and
 * `rho: null` rather than being omitted, matching buildRankStability's
 * convention in src/lib/analytics/analysis.ts. */
export function computeEnvironmentRankStability(
  rows: MetObservationRecord[],
): EnvironmentRankPair[] {
  const byEnvironment = entryMeansByEnvironment(rows);
  const environments = [...byEnvironment.entries()]
    .sort(([, a], [, b]) => b.size - a.size)
    .slice(0, MAX_RANK_STABILITY_ENVIRONMENTS)
    .map(([envId]) => envId)
    .sort();

  const pairs: EnvironmentRankPair[] = [];
  for (let i = 0; i < environments.length; i++) {
    for (let j = i + 1; j < environments.length; j++) {
      const environmentIdA = environments[i];
      const environmentIdB = environments[j];
      const meansA = byEnvironment.get(environmentIdA)!;
      const meansB = byEnvironment.get(environmentIdB)!;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [entryId, valueA] of meansA) {
        const valueB = meansB.get(entryId);
        if (valueB != null) {
          xs.push(valueA);
          ys.push(valueB);
        }
      }
      const topEntryA = topEntry(meansA);
      const topEntryB = topEntry(meansB);
      if (xs.length < MIN_SHARED_ENTRIES_FOR_RANK_PAIR) {
        pairs.push({
          environmentIdA,
          environmentIdB,
          pairedN: xs.length,
          rho: null,
          insufficientN: true,
          topEntryA,
          topEntryB,
          topEntryChanged: topEntryA !== topEntryB,
        });
        continue;
      }
      const result = spearmanCorrelation(xs, ys);
      pairs.push({
        environmentIdA,
        environmentIdB,
        pairedN: xs.length,
        rho: result?.r ?? null,
        topEntryA,
        topEntryB,
        topEntryChanged: topEntryA !== topEntryB,
      });
    }
  }
  return pairs;
}
