import { describe, expect, it } from "vitest";
import {
  buildMeanPerformanceMatrixFromRows,
  computeSelectionDifferentials,
} from "../src/lib/breeding-decision/selection-differential";
import type { BreedingCandidateTraitMatrix } from "../src/lib/breeding-decision/types";
import type { BreedingScenarioTraitSpec } from "../src/lib/breeding-decision/types";

function matrix(
  trait: Partial<BreedingCandidateTraitMatrix["traits"][number]>,
  valuesByCandidate: Record<string, number | null>,
): BreedingCandidateTraitMatrix {
  const candidateIds = Object.keys(valuesByCandidate);
  return {
    candidates: candidateIds.map((id) => ({
      candidateId: id,
      candidateCode: id,
      candidateLabel: id,
      candidateScientificRole: "genotype",
      operationallyEliminated: false,
    })),
    traits: [
      {
        traitId: "t1",
        traitCode: "t1",
        traitName: "Trait 1",
        unit: null,
        direction: "higher_is_better",
        targetValue: null,
        weight: null,
        economicWeight: null,
        sourceType: "RAW_PHENOTYPIC",
        sourceRunId: null,
        evaluationDate: null,
        ...trait,
      },
    ],
    cells: candidateIds.map((id) => ({
      candidateId: id,
      traitId: "t1",
      value: valuesByCandidate[id],
    })),
    evidenceLevel: "PHENOTYPIC",
    coverage: {
      candidateCount: candidateIds.length,
      traitCount: 1,
      completeCandidateCount: 0,
      missingCells: 0,
      coverage: 0,
    },
  };
}

describe("computeSelectionDifferentials", () => {
  it("computes population/selected means and a positive differential for higher_is_better", () => {
    const m = matrix(
      { direction: "higher_is_better" },
      { G1: 10, G2: 20, G3: 30 },
    );
    const [row] = computeSelectionDifferentials(m, ["G3"]);
    expect(row.populationMean).toBeCloseTo(20);
    expect(row.selectedMean).toBeCloseTo(30);
    expect(row.absoluteDifferential).toBeCloseTo(10);
    expect(row.percentageDifferential).toBeCloseTo(50);
    expect(row.directionAchieved).toBe(true);
  });

  it("flags directionAchieved=false when the selected mean moves the wrong way", () => {
    const m = matrix(
      { direction: "higher_is_better" },
      { G1: 10, G2: 20, G3: 30 },
    );
    const [row] = computeSelectionDifferentials(m, ["G1"]);
    expect(row.absoluteDifferential).toBeLessThan(0);
    expect(row.directionAchieved).toBe(false);
  });

  it("flips the achieved check for lower_is_better", () => {
    const m = matrix(
      { direction: "lower_is_better" },
      { G1: 10, G2: 20, G3: 30 },
    );
    const [lowSelected] = computeSelectionDifferentials(m, ["G1"]);
    expect(lowSelected.directionAchieved).toBe(true);
    const [highSelected] = computeSelectionDifferentials(m, ["G3"]);
    expect(highSelected.directionAchieved).toBe(false);
  });

  it("checks distance-to-target for target_value traits", () => {
    // population mean = 5, |5-15|=10. Selecting G3 (exactly on target)
    // moves distance-to-target to 0, closer than the population.
    // Selecting G1 (value 0) moves it to 15, farther than the population.
    const m = matrix(
      { direction: "target_value", targetValue: 15 },
      { G1: 0, G2: 0, G3: 15 },
    );
    const [closer] = computeSelectionDifferentials(m, ["G3"]);
    expect(closer.directionAchieved).toBe(true);
    const [farther] = computeSelectionDifferentials(m, ["G1"]);
    expect(farther.directionAchieved).toBe(false);
  });

  it("never reports a percentage differential against a zero population mean", () => {
    const m = matrix(
      { direction: "higher_is_better" },
      { G1: -5, G2: 5, G3: 0 },
    );
    const [row] = computeSelectionDifferentials(m, ["G2"]);
    expect(row.populationMean).toBeCloseTo(0);
    expect(row.percentageDifferential).toBeNull();
  });

  it("excludes missing values from both population and selected means", () => {
    const m = matrix(
      { direction: "higher_is_better" },
      { G1: 10, G2: null, G3: 30 },
    );
    const [row] = computeSelectionDifferentials(m, ["G1", "G3"]);
    expect(row.populationN).toBe(2);
    expect(row.populationMean).toBeCloseTo(20);
    expect(row.selectedN).toBe(2);
  });

  it("reports a precise zero differential for a tie, never a misleading non-zero percentage", () => {
    // Selecting a subset whose mean exactly equals the population mean -
    // a genuine tie, not a rounding artifact (task review §48).
    const m = matrix(
      { direction: "higher_is_better" },
      { G1: 10, G2: 20, G3: 10, G4: 20 },
    );
    const [row] = computeSelectionDifferentials(m, ["G1", "G2"]);
    expect(row.populationMean).toBeCloseTo(15);
    expect(row.selectedMean).toBeCloseTo(15);
    expect(row.absoluteDifferential).toBe(0);
    expect(row.percentageDifferential).toBe(0);
    expect(row.directionAchieved).toBe(false);
  });

  it("reports a null directionAchieved when the selected set has no supporting candidates", () => {
    const m = matrix({ direction: "higher_is_better" }, { G1: 10, G2: null });
    const [row] = computeSelectionDifferentials(m, ["G2"]);
    expect(row.selectedN).toBe(0);
    expect(row.directionAchieved).toBeNull();
  });
});

describe("buildMeanPerformanceMatrixFromRows", () => {
  const trait = (overrides: Partial<BreedingScenarioTraitSpec>) => ({
    traitId: "t1",
    traitCode: "t1",
    traitName: "t1",
    unit: null,
    direction: "higher_is_better" as const,
    targetValue: null,
    weight: null,
    economicWeight: null,
    sourceType: "WAASBY_STABILITY_PERFORMANCE" as const,
    sourceRunId: "run-1",
    evaluationDate: null,
    ...overrides,
  });

  it("averages every raw observation per (candidate, trait)", () => {
    const matrix = buildMeanPerformanceMatrixFromRows(
      [
        { entry_id: "G1", trait_id: "t1", value: 10 },
        { entry_id: "G1", trait_id: "t1", value: 20 },
        { entry_id: "G2", trait_id: "t1", value: 5 },
      ],
      [trait({})],
      ["G1", "G2"],
    );
    expect(matrix.cells.find((c) => c.candidateId === "G1")?.value).toBeCloseTo(
      15,
    );
    expect(matrix.cells.find((c) => c.candidateId === "G2")?.value).toBeCloseTo(
      5,
    );
  });

  it("reports a null cell (never a fabricated mean) for a candidate with zero observations for a trait", () => {
    const matrix = buildMeanPerformanceMatrixFromRows(
      [{ entry_id: "G1", trait_id: "t1", value: 10 }],
      [trait({})],
      ["G1", "G2"],
    );
    expect(matrix.cells.find((c) => c.candidateId === "G2")?.value).toBeNull();
    expect(matrix.coverage.completeCandidateCount).toBe(1);
  });

  it("feeds directly into computeSelectionDifferentials, producing a sensible differential", () => {
    const matrix = buildMeanPerformanceMatrixFromRows(
      [
        { entry_id: "G1", trait_id: "t1", value: 10 },
        { entry_id: "G2", trait_id: "t1", value: 20 },
        { entry_id: "G3", trait_id: "t1", value: 30 },
      ],
      [trait({ direction: "higher_is_better" })],
      ["G1", "G2", "G3"],
    );
    const [row] = computeSelectionDifferentials(matrix, ["G3"]);
    expect(row.populationMean).toBeCloseTo(20);
    expect(row.selectedMean).toBeCloseTo(30);
    expect(row.directionAchieved).toBe(true);
  });
});
