import { describe, expect, it } from "vitest";
import {
  compareAllMethodRankings,
  compareMethodRankings,
  selectionCoincidence,
} from "../src/lib/breeding-decision/method-comparison";
import type { MethodRanking } from "../src/lib/breeding-decision/method-comparison";

function ranking(
  methodName: string,
  rankByCandidateId: Record<string, number>,
  selected: string[],
): MethodRanking {
  return {
    methodName,
    rankByCandidateId: new Map(Object.entries(rankByCandidateId)),
    selectedCandidateIds: new Set(selected),
  };
}

describe("compareMethodRankings", () => {
  it("reports a perfect positive rank correlation for identical rankings", () => {
    const a = ranking("A", { G1: 1, G2: 2, G3: 3, G4: 4 }, ["G1"]);
    const b = ranking("B", { G1: 1, G2: 2, G3: 3, G4: 4 }, ["G1"]);
    const result = compareMethodRankings(a, b);
    expect(result.rankCorrelation).toBeCloseTo(1);
    expect(result.selectedOverlapProportion).toBe(1);
  });

  it("reports a perfect negative rank correlation for reversed rankings", () => {
    const a = ranking("A", { G1: 1, G2: 2, G3: 3, G4: 4 }, []);
    const b = ranking("B", { G1: 4, G2: 3, G3: 2, G4: 1 }, []);
    const result = compareMethodRankings(a, b);
    expect(result.rankCorrelation).toBeCloseTo(-1);
  });

  it("returns null rank correlation when fewer than 3 candidates are shared", () => {
    const a = ranking("A", { G1: 1, G2: 2 }, []);
    const b = ranking("B", { G1: 1, G2: 2 }, []);
    expect(compareMethodRankings(a, b).rankCorrelation).toBeNull();
  });

  it("computes selected-set overlap precisely (intersection over union)", () => {
    const a = ranking("A", { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5 }, ["G1", "G2"]);
    const b = ranking("B", { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5 }, ["G1", "G3"]);
    const result = compareMethodRankings(a, b);
    expect(result.selectedByBoth).toEqual(["G1"]);
    expect(result.selectedOnlyByA).toEqual(["G2"]);
    expect(result.selectedOnlyByB).toEqual(["G3"]);
    expect(result.selectedOverlapProportion).toBeCloseTo(1 / 3);
  });

  it("reports null overlap proportion when neither method selected anyone", () => {
    const a = ranking("A", { G1: 1, G2: 2, G3: 3 }, []);
    const b = ranking("B", { G1: 1, G2: 2, G3: 3 }, []);
    expect(compareMethodRankings(a, b).selectedOverlapProportion).toBeNull();
  });
});

describe("selectionCoincidence", () => {
  it("counts how many methods selected each candidate", () => {
    const rankings = [
      ranking("A", { G1: 1, G2: 2 }, ["G1"]),
      ranking("B", { G1: 1, G2: 2 }, ["G1", "G2"]),
      ranking("C", { G1: 1, G2: 2 }, ["G2"]),
    ];
    const counts = selectionCoincidence(rankings);
    expect(counts.get("G1")).toBe(2);
    expect(counts.get("G2")).toBe(2);
  });
});

describe("compareAllMethodRankings", () => {
  it("returns one comparison per pair for 3 methods", () => {
    const rankings = [
      ranking("A", { G1: 1, G2: 2, G3: 3 }, []),
      ranking("B", { G1: 1, G2: 2, G3: 3 }, []),
      ranking("C", { G1: 1, G2: 2, G3: 3 }, []),
    ];
    const comparisons = compareAllMethodRankings(rankings);
    expect(comparisons).toHaveLength(3);
    const pairs = comparisons.map((c) => `${c.methodA}-${c.methodB}`);
    expect(pairs).toEqual(["A-B", "A-C", "B-C"]);
  });
});
