import { describe, expect, it } from "vitest";
import {
  evaluateMtsiTraitEligibility,
  evaluateSelectionMethodEligibility,
} from "../src/lib/breeding-decision/eligibility";
import type { BreedingCandidateTraitMatrix } from "../src/lib/breeding-decision/types";

function matrix(
  nCandidates: number,
  nTraits: number,
  missing: [string, string][] = [],
): BreedingCandidateTraitMatrix {
  const candidateIds = Array.from(
    { length: nCandidates },
    (_, i) => `G${i + 1}`,
  );
  const traitIds = Array.from({ length: nTraits }, (_, i) => `t${i + 1}`);
  const missingSet = new Set(missing.map(([c, t]) => `${c}||${t}`));
  const cells = candidateIds.flatMap((c) =>
    traitIds.map((t) => ({
      candidateId: c,
      traitId: t,
      value: missingSet.has(`${c}||${t}`) ? null : 1,
    })),
  );
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
      candidateCount: nCandidates,
      traitCount: nTraits,
      completeCandidateCount: nCandidates - missing.length,
      missingCells: missing.length,
      coverage: 0,
    },
  };
}

describe("evaluateSelectionMethodEligibility: selection_mgidi_v1", () => {
  it("blocks fewer than 2 traits", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mgidi_v1",
      matrix(10, 1),
    );
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("au moins 2 traits"))).toBe(
      true,
    );
  });

  it("blocks when complete-case candidates <= traits", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mgidi_v1",
      matrix(2, 2),
    );
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("parfaitement saturée"))).toBe(
      true,
    );
  });

  it("is eligible once complete-case candidates exceed the trait count", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mgidi_v1",
      matrix(3, 2),
    );
    expect(report.eligible).toBe(true);
  });

  it("excludes incomplete candidates from the complete-case set and discloses them as a warning", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mgidi_v1",
      matrix(5, 2, [["G1", "t1"]]),
    );
    expect(report.eligible).toBe(true);
    expect(report.completeCaseCandidateIds).toHaveLength(4);
    expect(report.excludedForMissingData).toEqual(["G1"]);
    expect(
      report.warnings.some((w) => w.includes("1 candidat(s) exclu(s)")),
    ).toBe(true);
  });

  it("counts eligibility against the complete-case count, not the raw candidate count", () => {
    // 3 raw candidates, 2 traits, but 1 missing a value -> only 2 complete
    // cases remain, which is NOT strictly more than 2 traits.
    const report = evaluateSelectionMethodEligibility(
      "selection_mgidi_v1",
      matrix(3, 2, [["G1", "t1"]]),
    );
    expect(report.eligible).toBe(false);
  });
});

describe("evaluateSelectionMethodEligibility: selection_mtsi_v1", () => {
  it("is eligible with 2+ traits, none target_value", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mtsi_v1",
      matrix(10, 2),
    );
    expect(report.eligible).toBe(true);
  });

  it("blocks fewer than 2 traits", () => {
    const report = evaluateSelectionMethodEligibility(
      "selection_mtsi_v1",
      matrix(10, 1),
    );
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("au moins 2 traits"))).toBe(
      true,
    );
  });
});

describe("evaluateMtsiTraitEligibility", () => {
  const trait = (
    overrides: Partial<
      Parameters<typeof evaluateMtsiTraitEligibility>[0][number]
    >,
  ) => ({
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

  it("is eligible with 2+ traits, none target_value", () => {
    const report = evaluateMtsiTraitEligibility([
      trait({ traitId: "a", traitCode: "a" }),
      trait({ traitId: "b", traitCode: "b" }),
    ]);
    expect(report.eligible).toBe(true);
  });

  it("blocks a single trait", () => {
    const report = evaluateMtsiTraitEligibility([trait({})]);
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("une seule variable"))).toBe(
      true,
    );
  });

  it("blocks a target_value trait, naming it precisely", () => {
    const report = evaluateMtsiTraitEligibility([
      trait({ traitId: "a", traitCode: "yield" }),
      trait({
        traitId: "b",
        traitCode: "height",
        direction: "target_value",
        targetValue: 100,
      }),
    ]);
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("height"))).toBe(true);
  });
});
