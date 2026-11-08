import { describe, expect, it } from "vitest";
import { detectMetLongitudinalAmbiguity } from "../src/lib/met/design-summary";
import { evaluateMetOccasionEligibility } from "../src/lib/met/eligibility";
import type { MetObservationRecord } from "../src/lib/met/types";

const row = (
  phenotypeId: string,
  evaluationDate: string | null,
  overrides: Partial<MetObservationRecord> = {},
): MetObservationRecord => ({
  traitValueId: `${phenotypeId}-${evaluationDate}-${Math.random()}`,
  numericValue: 1,
  evaluationId: `eval-${phenotypeId}-${evaluationDate}-${Math.random()}`,
  evaluationDate,
  phenotypeId,
  phenotypeCode: `P-${phenotypeId}`,
  entryId: "E1",
  entryCode: "E1",
  entryLabel: "E1",
  entryScientificRole: "other",
  environmentId: "V1",
  environmentCode: "V1",
  siteId: "site-V1",
  siteCode: "V1",
  campaign: "2026A",
  block: null,
  replicate: null,
  ...overrides,
});

describe("detectMetLongitudinalAmbiguity (B-review blocker #3)", () => {
  it("is not ambiguous when every phenotype has a single evaluation date, even if phenotypes differ from each other", () => {
    const rows = [
      row("pheno-1", "2026-01-05", { environmentId: "V1" }),
      row("pheno-2", "2026-01-10", { environmentId: "V2" }),
    ];
    const result = detectMetLongitudinalAmbiguity(rows);
    expect(result.ambiguous).toBe(false);
    expect(result.availableDates).toEqual(["2026-01-05", "2026-01-10"]);
  });

  it("is ambiguous when the SAME phenotype has 2+ distinct evaluation dates", () => {
    const rows = [
      row("pheno-1", "2026-01-05"),
      row("pheno-1", "2026-01-19"),
      row("pheno-2", "2026-01-05"),
    ];
    const result = detectMetLongitudinalAmbiguity(rows);
    expect(result.ambiguous).toBe(true);
    expect(result.availableDates).toEqual(["2026-01-05", "2026-01-19"]);
  });

  it("ignores null evaluation dates when checking for ambiguity", () => {
    const rows = [row("pheno-1", null), row("pheno-1", "2026-01-05")];
    const result = detectMetLongitudinalAmbiguity(rows);
    expect(result.ambiguous).toBe(false);
    expect(result.availableDates).toEqual(["2026-01-05"]);
  });

  it("sorts available dates ascending", () => {
    const rows = [
      row("pheno-1", "2026-03-01"),
      row("pheno-2", "2026-01-01"),
      row("pheno-3", "2026-02-01"),
    ];
    const result = detectMetLongitudinalAmbiguity(rows);
    expect(result.availableDates).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });
});

describe("evaluateMetOccasionEligibility (B-review blocker #3)", () => {
  it("blocks when ambiguous and no occasion was selected", () => {
    const rows = [row("pheno-1", "2026-01-05"), row("pheno-1", "2026-01-19")];
    const report = evaluateMetOccasionEligibility(rows, null);
    expect(report.eligible).toBe(false);
    expect(
      report.reasons.some((r) => r.includes("longitudinales répétées")),
    ).toBe(true);
    expect(report.availableDates).toEqual(["2026-01-05", "2026-01-19"]);
  });

  it("allows it once an explicit occasion is selected", () => {
    const rows = [row("pheno-1", "2026-01-05"), row("pheno-1", "2026-01-19")];
    const report = evaluateMetOccasionEligibility(rows, "2026-01-05");
    expect(report.eligible).toBe(true);
    expect(report.reasons).toEqual([]);
  });

  it("never blocks when there is no ambiguity, regardless of selection", () => {
    const rows = [row("pheno-1", "2026-01-05"), row("pheno-2", "2026-01-19")];
    expect(evaluateMetOccasionEligibility(rows, null).eligible).toBe(true);
    expect(evaluateMetOccasionEligibility(rows, "2026-01-05").eligible).toBe(
      true,
    );
  });
});
