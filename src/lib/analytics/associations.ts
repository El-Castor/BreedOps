import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pearsonCorrelation,
  spearmanCorrelation,
  correlationPValue,
  benjaminiHochberg,
} from "./stats";
import { buildObservationDataset, type NumericTraitOption } from "./dataset";
import { MIN_ASSOCIATION_PAIRED_N } from "./eligibility";
import type {
  AnalyticsFilters,
  ObservationRecord,
  TraitAssociation,
} from "./types";

/** Pairs two traits' observations by `evaluationId` - the same scoring
 * event, never two different occasions for the same phenotype (task §26:
 * "phenotypic association", a real co-occurring measurement, not an
 * inferred one). */
function pairByEvaluation(
  primary: ObservationRecord[],
  other: ObservationRecord[],
) {
  const otherByEvaluation = new Map(
    other.map((r) => [r.evaluationId, r.numericValue]),
  );
  const xs: number[] = [];
  const ys: number[] = [];
  for (const row of primary) {
    const otherValue = otherByEvaluation.get(row.evaluationId);
    if (otherValue != null) {
      xs.push(row.numericValue);
      ys.push(otherValue);
    }
  }
  return { xs, ys };
}

/** Pairwise phenotypic associations between the primary trait and every
 * other numeric trait active in the same program/cohort (task §26/§27).
 * Applies Benjamini-Hochberg FDR correction across every pair actually
 * tested (not per-pair in isolation), and never silently imputes a missing
 * pairing. */
export async function computeTraitAssociations(
  client: SupabaseClient,
  filters: AnalyticsFilters,
  primaryRows: ObservationRecord[],
  otherTraits: NumericTraitOption[],
): Promise<TraitAssociation[]> {
  const candidates = otherTraits.filter((t) => t.traitId !== filters.traitId);
  const results: (TraitAssociation & { pearsonPRaw: number | null })[] = [];
  for (const trait of candidates) {
    const { rows } = await buildObservationDataset(
      client,
      { ...filters, traitId: trait.traitId },
      trait,
    );
    const { xs, ys } = pairByEvaluation(primaryRows, rows);
    if (xs.length < MIN_ASSOCIATION_PAIRED_N) {
      results.push({
        traitId: trait.traitId,
        traitCode: trait.code,
        traitName: trait.name,
        pairedN: xs.length,
        pearsonR: null,
        pearsonP: null,
        pearsonQ: null,
        spearmanRho: null,
        pearsonPRaw: null,
      });
      continue;
    }
    const pearson = pearsonCorrelation(xs, ys);
    const spearman = spearmanCorrelation(xs, ys);
    const pValue = pearson ? correlationPValue(pearson.r, pearson.n) : null;
    results.push({
      traitId: trait.traitId,
      traitCode: trait.code,
      traitName: trait.name,
      pairedN: xs.length,
      pearsonR: pearson?.r ?? null,
      pearsonP: pValue,
      pearsonQ: null,
      spearmanRho: spearman?.r ?? null,
      pearsonPRaw: pValue,
    });
  }

  const testable = results
    .map((r, index) => ({ index, p: r.pearsonPRaw }))
    .filter((r): r is { index: number; p: number } => r.p != null);
  if (testable.length > 0) {
    const bh = benjaminiHochberg(testable.map((t) => t.p));
    testable.forEach((t, i) => {
      results[t.index].pearsonQ = bh[i].q;
    });
  }

  return results.map(({ pearsonPRaw, ...rest }) => rest);
}
