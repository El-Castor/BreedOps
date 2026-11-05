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
