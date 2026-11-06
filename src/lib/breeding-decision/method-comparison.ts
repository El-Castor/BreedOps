// Pure function only - no "server-only" guard, directly unit-testable.
// Task review §29: a transparent way to compare rankings from different
// methods (including the existing operational weighted score), never a
// declaration that one method is universally "best".
import { spearmanCorrelation } from "../analytics/stats";

export type MethodRanking = {
  methodName: string;
  /** candidateId -> rank, 1 = best/closest to the ideotype. */
  rankByCandidateId: Map<string, number>;
  selectedCandidateIds: ReadonlySet<string>;
};

export type MethodComparison = {
  methodA: string;
  methodB: string;
  sharedCandidateCount: number;
  /** Spearman rank correlation over the candidates both methods ranked -
   * null when fewer than 3 are shared (spearmanCorrelation's own
   * minimum), never a fabricated value. */
  rankCorrelation: number | null;
  selectedByBoth: string[];
  selectedOnlyByA: string[];
  selectedOnlyByB: string[];
  /** |selected by both| / |selected by either| - 1 means identical
   * selected sets, 0 means no overlap at all. Null when neither method
   * selected anyone. */
  selectedOverlapProportion: number | null;
};

export function compareMethodRankings(
  a: MethodRanking,
  b: MethodRanking,
): MethodComparison {
  const sharedCandidateIds = [...a.rankByCandidateId.keys()].filter((id) =>
    b.rankByCandidateId.has(id),
  );
  const ranksA = sharedCandidateIds.map((id) => a.rankByCandidateId.get(id)!);
  const ranksB = sharedCandidateIds.map((id) => b.rankByCandidateId.get(id)!);
  const correlation = spearmanCorrelation(ranksA, ranksB);

  const selectedByBoth = [...a.selectedCandidateIds].filter((id) =>
    b.selectedCandidateIds.has(id),
  );
  const selectedOnlyByA = [...a.selectedCandidateIds].filter(
    (id) => !b.selectedCandidateIds.has(id),
  );
  const selectedOnlyByB = [...b.selectedCandidateIds].filter(
    (id) => !a.selectedCandidateIds.has(id),
  );
  const unionSize =
    selectedByBoth.length + selectedOnlyByA.length + selectedOnlyByB.length;

  return {
    methodA: a.methodName,
    methodB: b.methodName,
    sharedCandidateCount: sharedCandidateIds.length,
    rankCorrelation: correlation ? correlation.r : null,
    selectedByBoth,
    selectedOnlyByA,
    selectedOnlyByB,
    selectedOverlapProportion:
      unionSize > 0 ? selectedByBoth.length / unionSize : null,
  };
}

/** For every candidate, how many of the given methods selected it - the
 * "selected by N/M evaluated methods" evidence the UI shows instead of
 * an opaque recommendation (task review §31). */
export function selectionCoincidence(
  rankings: readonly MethodRanking[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ranking of rankings) {
    for (const candidateId of ranking.selectedCandidateIds) {
      counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1);
    }
  }
  return counts;
}

/** All pairwise comparisons among 2+ rankings - the table the UI
 * renders directly (task review §29). */
export function compareAllMethodRankings(
  rankings: readonly MethodRanking[],
): MethodComparison[] {
  const comparisons: MethodComparison[] = [];
  for (let i = 0; i < rankings.length; i++) {
    for (let j = i + 1; j < rankings.length; j++) {
      comparisons.push(compareMethodRankings(rankings[i], rankings[j]));
    }
  }
  return comparisons;
}
