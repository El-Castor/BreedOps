import { describe, expect, it } from "vitest";
import {
  evaluateMetEligibility,
  MIN_ENTRIES,
  MIN_ENVIRONMENTS,
} from "../src/lib/met/eligibility";
import type { MetObservationRecord } from "../src/lib/met/types";

const row = (
  entryId: string,
  environmentId: string,
  overrides: Partial<MetObservationRecord> = {},
): MetObservationRecord => ({
  traitValueId: `${entryId}-${environmentId}-${Math.random()}`,
  numericValue: 1,
  evaluationId: `eval-${entryId}-${environmentId}`,
  evaluationDate: "2026-01-01",
  phenotypeId: `pheno-${entryId}-${environmentId}`,
  phenotypeCode: `P-${entryId}-${environmentId}`,
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

function balancedDesign(entries: string[], environments: string[]) {
  const rows: MetObservationRecord[] = [];
  for (const e of entries)
    for (const env of environments) rows.push(row(e, env));
  return rows;
}

describe("evaluateMetEligibility", () => {
  it("is eligible for a balanced design with every entry shared across every environment", () => {
    const report = evaluateMetEligibility(
      balancedDesign(["E1", "E2", "E3"], ["ENV1", "ENV2"]),
    );
    expect(report.eligible).toBe(true);
    expect(report.reasons).toEqual([]);
    expect(report.design.entryCount).toBe(3);
    expect(report.design.environmentCount).toBe(2);
    expect(report.balance.isBalanced).toBe(true);
    expect(report.balance.missingCells).toBe(0);
  });

  it(`is NOT eligible with fewer than ${MIN_ENVIRONMENTS} environments`, () => {
    const report = evaluateMetEligibility(
      balancedDesign(["E1", "E2"], ["ENV1"]),
    );
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("environnements"))).toBe(true);
  });

  it(`is NOT eligible with fewer than ${MIN_ENTRIES} entries`, () => {
    const report = evaluateMetEligibility(
      balancedDesign(["E1"], ["ENV1", "ENV2"]),
    );
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("entrées"))).toBe(true);
  });

  it("is NOT eligible when no entry is shared across 2+ environments, even with enough raw counts", () => {
    // 4 entries, 2 environments, but each entry appears in exactly one
    // environment: the entry x environment effect is not identifiable.
    const rows = [
      row("E1", "ENV1"),
      row("E2", "ENV1"),
      row("E3", "ENV2"),
      row("E4", "ENV2"),
    ];
    const report = evaluateMetEligibility(rows);
    expect(report.eligible).toBe(false);
    expect(report.reasons.some((r) => r.includes("commune"))).toBe(true);
    // Only the shared-entries reason should fire - entry/environment
    // counts both already pass their own minimums.
    expect(report.reasons).toHaveLength(1);
  });

  it("reports multiple blocking reasons at once when several checks fail", () => {
    const report = evaluateMetEligibility([row("E1", "ENV1")]);
    expect(report.eligible).toBe(false);
    expect(report.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("warns about missing cells in an unbalanced-but-eligible design, without blocking it", () => {
    const rows = [
      row("E1", "ENV1"),
      row("E1", "ENV2"),
      row("E2", "ENV1"),
      row("E2", "ENV2"),
      row("E3", "ENV1"),
      // E3 is missing from ENV2 - still eligible (E1/E2 are shared), but
      // the design is unbalanced.
    ];
    const report = evaluateMetEligibility(rows);
    expect(report.eligible).toBe(true);
    expect(report.balance.isBalanced).toBe(false);
    expect(report.balance.missingCells).toBe(1);
    expect(report.warnings.some((w) => w.includes("déséquilibré"))).toBe(true);
  });

  it("warns about single-observation cells when the design is otherwise balanced", () => {
    const rows = balancedDesign(["E1", "E2"], ["ENV1", "ENV2"]);
    const report = evaluateMetEligibility(rows);
    expect(report.eligible).toBe(true);
    expect(report.balance.isBalanced).toBe(true);
    expect(
      report.warnings.some((w) => w.includes("une seule observation")),
    ).toBe(true);
  });

  it("never fabricates an eligible result for an empty dataset", () => {
    const report = evaluateMetEligibility([]);
    expect(report.eligible).toBe(false);
    expect(report.reasons.length).toBeGreaterThan(0);
  });
});
