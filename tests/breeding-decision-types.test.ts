import { describe, expect, it } from "vitest";
import {
  completeCaseCandidateIds,
  evidenceLevelForSource,
  getCell,
  weakestEvidenceLevel,
} from "../src/lib/breeding-decision/types";
import type { BreedingCandidateTraitMatrix } from "../src/lib/breeding-decision/types";

describe("evidenceLevelForSource", () => {
  it("maps phenotypic sources to PHENOTYPIC", () => {
    expect(evidenceLevelForSource("RAW_PHENOTYPIC")).toBe("PHENOTYPIC");
    expect(evidenceLevelForSource("PHENOTYPIC_MEAN")).toBe("PHENOTYPIC");
  });
  it("maps model-derived sources to ADJUSTED_ENTRY, never higher", () => {
    expect(evidenceLevelForSource("MET_ENTRY_PREDICTION")).toBe(
      "ADJUSTED_ENTRY",
    );
    expect(evidenceLevelForSource("WAASBY_STABILITY_PERFORMANCE")).toBe(
      "ADJUSTED_ENTRY",
    );
  });
});

describe("weakestEvidenceLevel", () => {
  it("returns the weakest level present, never upgrading", () => {
    expect(weakestEvidenceLevel(["ADJUSTED_ENTRY", "PHENOTYPIC"])).toBe(
      "PHENOTYPIC",
    );
    expect(
      weakestEvidenceLevel(["GENOTYPIC", "ADDITIVE_GENETIC", "GENOTYPIC"]),
    ).toBe("GENOTYPIC");
  });
  it("defaults to the strongest level only when every input is that level", () => {
    expect(weakestEvidenceLevel(["ADDITIVE_GENETIC"])).toBe("ADDITIVE_GENETIC");
  });
});

function buildMatrix(
  cells: { candidateId: string; traitId: string; value: number | null }[],
): BreedingCandidateTraitMatrix {
  const candidateIds = [...new Set(cells.map((c) => c.candidateId))];
  const traitIds = [...new Set(cells.map((c) => c.traitId))];
  return {
    candidates: candidateIds.map((id) => ({
      candidateId: id,
      candidateCode: id,
      candidateLabel: id,
      candidateScientificRole: "genotype",
      operationallyEliminated: false,
    })),
    traits: traitIds.map((id) => ({
      traitId: id,
      traitCode: id,
      traitName: id,
      unit: null,
      direction: "higher_is_better",
      targetValue: null,
      weight: null,
      economicWeight: null,
      sourceType: "RAW_PHENOTYPIC",
      sourceRunId: null,
      evaluationDate: null,
    })),
    cells,
    evidenceLevel: "PHENOTYPIC",
    coverage: {
      candidateCount: candidateIds.length,
      traitCount: traitIds.length,
      completeCandidateCount: 0,
      missingCells: 0,
      coverage: 0,
    },
  };
}

describe("getCell / completeCaseCandidateIds", () => {
  it("finds the exact cell for a candidate x trait pair", () => {
    const matrix = buildMatrix([
      { candidateId: "G1", traitId: "yield", value: 10 },
      { candidateId: "G1", traitId: "height", value: 5 },
    ]);
    expect(getCell(matrix, "G1", "yield")).toBe(10);
    expect(getCell(matrix, "G1", "height")).toBe(5);
  });

  it("returns null for a missing cell rather than throwing", () => {
    const matrix = buildMatrix([
      { candidateId: "G1", traitId: "yield", value: 10 },
    ]);
    expect(getCell(matrix, "G1", "height")).toBeNull();
    expect(getCell(matrix, "G2", "yield")).toBeNull();
  });

  it("includes only candidates with a non-null value for every trait", () => {
    const matrix = buildMatrix([
      { candidateId: "G1", traitId: "yield", value: 10 },
      { candidateId: "G1", traitId: "height", value: 5 },
      { candidateId: "G2", traitId: "yield", value: 8 },
      { candidateId: "G2", traitId: "height", value: null },
    ]);
    expect(completeCaseCandidateIds(matrix)).toEqual(["G1"]);
  });
});
