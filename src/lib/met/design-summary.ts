// Pure function only (no DB/network access) - no "server-only" guard so it
// stays directly unit-testable, same convention as
// src/lib/analytics/fingerprint.ts and src/lib/media/temporal.ts.
import type { MetObservationRecord } from "./types";

export type MetDesignSummary = {
  entryCount: number;
  environmentCount: number;
  /** Entries present in at least 2 environments - the minimum for any
   * Entry×Environment comparison to mean anything at all. */
  sharedEntryCount: number;
};

/** A cheap, non-statistical summary of which entries/environments are
 * actually present in a fetched dataset - used by the eligibility engine
 * (B13-B14) as its raw input, never as a substitute for it. Deriving this
 * from an already-fetched, non-`tooLarge` dataset is fine (same rule as
 * `deriveFilterOptions` in V2-04): it describes what was fetched, it does
 * not compute a statistic from it. */
export function summarizeMetDesign(
  rows: MetObservationRecord[],
): MetDesignSummary {
  const entryEnvironments = new Map<string, Set<string>>();
  const environments = new Set<string>();
  for (const row of rows) {
    environments.add(row.environmentId);
    const envs = entryEnvironments.get(row.entryId) ?? new Set<string>();
    envs.add(row.environmentId);
    entryEnvironments.set(row.entryId, envs);
  }
  let sharedEntryCount = 0;
  for (const envs of entryEnvironments.values()) {
    if (envs.size >= 2) sharedEntryCount += 1;
  }
  return {
    entryCount: entryEnvironments.size,
    environmentCount: environments.size,
    sharedEntryCount,
  };
}

/** Mean observed value per entry x environment cell, keyed
 * `${entryId}||${environmentId}` - the UI heatmap's direct input (B34).
 * Averages over replicates/blocks within the same cell, same granularity
 * every MET model is itself fit at. A missing key means no observation
 * for that cell; callers render that as an explicit empty cell, never a
 * fabricated 0. */
export function computeEntryEnvironmentCellMeans(
  rows: MetObservationRecord[],
): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const key = `${row.entryId}||${row.environmentId}`;
    const cell = sums.get(key) ?? { total: 0, count: 0 };
    cell.total += row.numericValue;
    cell.count += 1;
    sums.set(key, cell);
  }
  const means = new Map<string, number>();
  for (const [key, { total, count }] of sums) means.set(key, total / count);
  return means;
}

export type MetCellReplicationDiagnostics = {
  populatedCells: number;
  totalObservations: number;
  /** Cells with 2+ observations. The met_base_v1 identifiability
   * requirement (B-review blocker #2, see src/lib/met/eligibility.ts) is
   * `replicatedCells >= 1` - equivalently `populatedCells <
   * totalObservations` - confirmed empirically against lme4::lmer()'s own
   * hard check ("number of levels of each grouping factor must be <
   * number of observations"): with every cell holding exactly one
   * observation, the Entry×Environment variance and the residual
   * variance are not separately identifiable. This is not an arbitrary
   * threshold; it is the standard mixed-model identifiability
   * requirement. */
  replicatedCells: number;
};

/** Per entry×environment cell, how many observations it actually has -
 * the raw input to the met_base_v1-specific replication-identifiability
 * check. Pure/non-statistical, same convention as the rest of this
 * module. */
export function computeCellReplicationDiagnostics(
  rows: MetObservationRecord[],
): MetCellReplicationDiagnostics {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.entryId}||${row.environmentId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let replicatedCells = 0;
  for (const count of counts.values()) {
    if (count >= 2) replicatedCells += 1;
  }
  return {
    populatedCells: counts.size,
    totalObservations: rows.length,
    replicatedCells,
  };
}

export type MetOccasionDiagnostics = {
  /** True only when the SAME phenotype (the same Entry×Environment
   * physical unit) has 2+ distinct evaluation_date values contributing a
   * value for this trait - i.e. repeated/longitudinal measurements of one
   * unit, which must never be pooled as if they were independent
   * replicates (B-review blocker #3). Different phenotypes merely having
   * been evaluated on different calendar dates - the normal case for a
   * multi-environment trial, where each environment is its own campaign -
   * never triggers this: only the SAME phenotype appearing under 2+
   * distinct dates does. */
  ambiguous: boolean;
  /** Every distinct non-null evaluation_date present in the dataset,
   * sorted ascending - the candidate occasions offered to the user to
   * choose from when `ambiguous` is true. */
  availableDates: string[];
};

/** Raw input to the occasion-ambiguity gate
 * (src/lib/met/eligibility.ts's evaluateMetOccasionEligibility) - must be
 * run against an UNFILTERED fetch (every date, not just one occasion) to
 * mean anything. Pure/non-statistical, same convention as the rest of
 * this module. */
export function detectMetLongitudinalAmbiguity(
  rows: MetObservationRecord[],
): MetOccasionDiagnostics {
  const datesByPhenotype = new Map<string, Set<string>>();
  const allDates = new Set<string>();
  for (const row of rows) {
    if (!row.evaluationDate) continue;
    allDates.add(row.evaluationDate);
    const dates = datesByPhenotype.get(row.phenotypeId) ?? new Set<string>();
    dates.add(row.evaluationDate);
    datesByPhenotype.set(row.phenotypeId, dates);
  }
  let ambiguous = false;
  for (const dates of datesByPhenotype.values()) {
    if (dates.size >= 2) {
      ambiguous = true;
      break;
    }
  }
  return { ambiguous, availableDates: [...allDates].sort() };
}
