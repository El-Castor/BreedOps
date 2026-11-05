// Pure function only (no DB/network access) - no "server-only" guard, same
// convention as design-summary.ts, so it stays directly unit-testable.
//
// Runs BEFORE any G×E model is ever attempted (B13-B14): a cheap,
// deterministic check of whether the fetched MET dataset actually supports
// an Entry×Environment analysis at all, with specific reasons rather than
// a fabricated result. Mirrors the eligibility gate already enforced
// server-side inside analytics-r/scripts/met_models.R (MIN_ENTRIES,
// MIN_ENVIRONMENTS, the shared-entries check) so the UI can show the exact
// same verdict - and avoid spawning the R engine at all - without that
// duplication ever becoming the single source of truth: met_models.R
// re-checks independently and is what actually decides NOT_ESTIMABLE for
// any real analysis request, this module is a fast pre-flight mirror of
// it, not a replacement for it.
import { summarizeMetDesign, type MetDesignSummary } from "./design-summary";
import type { MetObservationRecord } from "./types";

/** MUST match MIN_ENTRIES in analytics-r/scripts/met_models.R. */
export const MIN_ENTRIES = 2;
/** MUST match MIN_ENVIRONMENTS in analytics-r/scripts/met_models.R. */
export const MIN_ENVIRONMENTS = 2;
/** MUST match the shared-entries threshold in
 * analytics-r/scripts/met_models.R (there, `entries_in_multiple_envs <
 * MIN_ENTRIES`); kept as its own named constant here because it is a
 * logically distinct requirement (replicated material, not raw entry
 * count) even though its numeric value happens to be the same today. */
export const MIN_SHARED_ENTRIES = MIN_ENTRIES;

export type MetBalanceSummary = {
  /** Every populated entry x environment cell has the same number of
   * observations. A design can be eligible without being balanced -
   * sommer/metan both handle unbalanced data (B15/B19) - this is reported
   * as a warning, never a blocker. */
  isBalanced: boolean;
  minCellObservations: number;
  maxCellObservations: number;
  /** Entry x environment combinations with zero observations, out of
   * entryCount x environmentCount. A trial design can legitimately have
   * missing cells (not every entry is sown everywhere); this is never
   * silently imputed (B40) - only reported. */
  missingCells: number;
  totalCells: number;
};

export type MetEligibilityReport = {
  eligible: boolean;
  /** Blocking reasons - non-empty if and only if eligible is false. Each
   * reason is precise enough to show directly in the UI, in French,
   * matching the wording met_models.R itself uses for the same checks. */
  reasons: string[];
  /** Non-blocking cautions about the design (imbalance, missing cells,
   * single-replicate cells, ...): surfaced to the user, never acted on
   * silently and never upgraded into a blocking reason on their own. */
  warnings: string[];
  design: MetDesignSummary;
  balance: MetBalanceSummary;
};

function computeBalance(rows: MetObservationRecord[]): MetBalanceSummary {
  const cellCounts = new Map<string, number>();
  const entries = new Set<string>();
  const environments = new Set<string>();
  for (const row of rows) {
    entries.add(row.entryId);
    environments.add(row.environmentId);
    const key = `${row.entryId}||${row.environmentId}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const totalCells = entries.size * environments.size;
  const populatedCounts = [...cellCounts.values()];
  const minCellObservations = populatedCounts.length
    ? Math.min(...populatedCounts)
    : 0;
  const maxCellObservations = populatedCounts.length
    ? Math.max(...populatedCounts)
    : 0;
  const missingCells = totalCells - cellCounts.size;
  return {
    isBalanced:
      missingCells === 0 && minCellObservations === maxCellObservations,
    minCellObservations,
    maxCellObservations,
    missingCells,
    totalCells,
  };
}

/** The one eligibility verdict every V2-05 UI screen and R-engine caller
 * should check before offering/running an analysis. Never returns
 * `eligible: true` by any path other than passing every one of the three
 * hard checks below - there is no "mostly eligible" or best-effort mode. */
export function evaluateMetEligibility(
  rows: MetObservationRecord[],
): MetEligibilityReport {
  const design = summarizeMetDesign(rows);
  const balance = computeBalance(rows);
  const reasons: string[] = [];

  if (design.environmentCount < MIN_ENVIRONMENTS) {
    reasons.push(
      `Au moins ${MIN_ENVIRONMENTS} environnements distincts sont nécessaires (trouvé : ${design.environmentCount}).`,
    );
  }
  if (design.entryCount < MIN_ENTRIES) {
    reasons.push(
      `Au moins ${MIN_ENTRIES} entrées distinctes sont nécessaires (trouvé : ${design.entryCount}).`,
    );
  }
  // Only check shared-entries coverage once the basic counts already pass -
  // identical gating order to met_models.R, so the same dataset never gets
  // a different reason from the two layers.
  if (reasons.length === 0 && design.sharedEntryCount < MIN_SHARED_ENTRIES) {
    reasons.push(
      "Aucune entrée commune n'est observée dans au moins deux environnements : l'effet Entrée x Environnement n'est pas identifiable.",
    );
  }

  const warnings: string[] = [];
  if (reasons.length === 0) {
    if (balance.missingCells > 0) {
      warnings.push(
        `${balance.missingCells} combinaison(s) entrée x environnement sur ${balance.totalCells} n'ont aucune observation - le jeu de données est déséquilibré.`,
      );
    }
    if (balance.minCellObservations === 1 && balance.missingCells === 0) {
      warnings.push(
        "Certaines combinaisons entrée x environnement n'ont qu'une seule observation : la précision de l'estimation de l'interaction peut être faible.",
      );
    }
  }

  return { eligible: reasons.length === 0, reasons, warnings, design, balance };
}
