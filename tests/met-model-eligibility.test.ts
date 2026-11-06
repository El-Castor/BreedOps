import { describe, expect, it } from "vitest";
import { evaluateMetModelEligibility } from "../src/lib/met/eligibility";
import type { MetObservationRecord } from "../src/lib/met/types";

const row = (
  entryId: string,
  environmentId: string,
  overrides: Partial<MetObservationRecord> = {},
): MetObservationRecord => ({
  traitValueId: `${entryId}-${environmentId}-${Math.random()}`,
  numericValue: 1,
  evaluationId: `eval-${entryId}-${environmentId}-${Math.random()}`,
  evaluationDate: "2026-01-01",
  phenotypeId: `pheno-${entryId}-${environmentId}-${Math.random()}`,
  phenotypeCode: `P-${entryId}-${environmentId}-${Math.random()}`,
  entryId,
  entryCode: entryId,
  entryLabel: entryId,
  entryScientificRole: "other",
  environmentId,
  environmentCode: environmentId,
  siteId: `site-${environmentId}`,
  siteCode: environmentId,
  campaign: "2026A",
  block: null,
  replicate: null,
  ...overrides,
});

function balancedDesign(
  entries: string[],
  environments: string[],
  repsPerCell = 1,
) {
  const rows: MetObservationRecord[] = [];
  for (const e of entries) {
    for (const env of environments) {
      for (let i = 0; i < repsPerCell; i++) rows.push(row(e, env));
    }
  }
  return rows;
}

describe("evaluateMetModelEligibility: met_base_v1 (B-review blocker #2)", () => {
  it("blocks a design with exactly one observation per cell (no within-cell replication)", () => {
    const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2"], 1);
    const report = evaluateMetModelEligibility("met_base_v1", rows);
    expect(report.eligible).toBe(false);
    expect(
      report.reasons.some((r) => r.includes("identifiables séparément")),
    ).toBe(true);
    expect(report.replication).toEqual({
      populatedCells: 6,
      totalObservations: 6,
      replicatedCells: 0,
    });
  });

  it("allows a fully replicated design (every cell has 2+ observations)", () => {
    const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2"], 3);
    const report = evaluateMetModelEligibility("met_base_v1", rows);
    expect(report.eligible).toBe(true);
    expect(report.replication?.replicatedCells).toBe(6);
    expect(report.replication?.populatedCells).toBe(6);
    expect(report.warnings).toEqual([]);
  });

  it("allows a partially replicated design but warns with the exact replicated/populated counts", () => {
    const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2"], 1);
    rows.push(row("E1", "V1")); // exactly one extra replicate, on one cell only
    const report = evaluateMetModelEligibility("met_base_v1", rows);
    expect(report.eligible).toBe(true);
    expect(report.replication).toEqual({
      populatedCells: 6,
      totalObservations: 7,
      replicatedCells: 1,
    });
    expect(report.warnings.some((w) => w.includes("1 cellule(s) sur 6"))).toBe(
      true,
    );
  });

  it("still applies the generic gate first (too few environments blocks before replication is even checked)", () => {
    const rows = balancedDesign(["E1", "E2"], ["V1"], 3);
    const report = evaluateMetModelEligibility("met_base_v1", rows);
    expect(report.eligible).toBe(false);
    expect(report.replication).toBeUndefined();
  });
});

describe("evaluateMetModelEligibility: met_waasb_v1 / met_ammi_v1 strict >2/>2 minimum", () => {
  it.each(["met_waasb_v1", "met_ammi_v1"] as const)(
    "%s blocks exactly 2 environments even with enough entries",
    (modelType) => {
      const rows = balancedDesign(
        ["E1", "E2", "E3", "E4", "E5"],
        ["V1", "V2"],
        3,
      );
      const report = evaluateMetModelEligibility(modelType, rows);
      expect(report.eligible).toBe(false);
      expect(
        report.reasons.some((r) =>
          r.includes("plus de 2 entrées et plus de 2 environnements"),
        ),
      ).toBe(true);
    },
  );

  it.each(["met_waasb_v1", "met_ammi_v1"] as const)(
    "%s is eligible with 3 entries and 3 environments",
    (modelType) => {
      const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2", "V3"], 3);
      const report = evaluateMetModelEligibility(modelType, rows);
      expect(report.eligible).toBe(true);
    },
  );

  it("met_base_v1 is NOT subject to the stricter >2/>2 minimum (only needs 2/2, per its own replication rule)", () => {
    const rows = balancedDesign(["E1", "E2"], ["V1", "V2"], 2);
    const report = evaluateMetModelEligibility("met_base_v1", rows);
    expect(report.eligible).toBe(true);
  });
});

describe("evaluateMetModelEligibility: met_ammi_v1 / met_gge_v1 missing-cell imputation disclosure (B40)", () => {
  it.each(["met_ammi_v1", "met_gge_v1"] as const)(
    "%s warns about missing cells being imputed (EM-SVD), never silently",
    (modelType) => {
      const rows = balancedDesign(
        ["E1", "E2", "E3"],
        ["V1", "V2", "V3"],
        3,
      ).filter((r) => !(r.entryId === "E1" && r.environmentId === "V1"));
      const report = evaluateMetModelEligibility(modelType, rows);
      expect(report.eligible).toBe(true);
      expect(report.warnings.some((w) => w.includes("EM-SVD"))).toBe(true);
    },
  );

  it("does not warn about imputation when the design is complete", () => {
    const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2", "V3"], 3);
    const report = evaluateMetModelEligibility("met_ammi_v1", rows);
    expect(report.warnings.some((w) => w.includes("EM-SVD"))).toBe(false);
  });
});

describe("evaluateMetModelEligibility: met_finlay_wilkinson_v1 per-entry environment coverage", () => {
  it("blocks the whole analysis when one entry is observed in only 1 environment", () => {
    const rows = [
      ...balancedDesign(["E2", "E3"], ["V1", "V2", "V3"], 2),
      ...balancedDesign(["E1"], ["V1"], 2),
    ];
    const report = evaluateMetModelEligibility("met_finlay_wilkinson_v1", rows);
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("E1"))).toBe(true);
  });

  it("is eligible when every entry is observed in at least 2 environments", () => {
    const rows = balancedDesign(["E1", "E2", "E3"], ["V1", "V2"], 2);
    const report = evaluateMetModelEligibility("met_finlay_wilkinson_v1", rows);
    expect(report.eligible).toBe(true);
  });
});
