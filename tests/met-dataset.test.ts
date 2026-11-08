import { describe, expect, it } from "vitest";
import { summarizeMetDesign } from "../src/lib/met/design-summary";
import type { MetObservationRecord } from "../src/lib/met/types";

const row = (
  entryId: string,
  environmentId: string,
  overrides: Partial<MetObservationRecord> = {},
): MetObservationRecord => ({
  traitValueId: `${entryId}-${environmentId}`,
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

describe("summarizeMetDesign", () => {
  it("counts distinct entries and environments", () => {
    const rows = [
      row("E1", "ENV1"),
      row("E1", "ENV2"),
      row("E2", "ENV1"),
      row("E2", "ENV2"),
    ];
    const summary = summarizeMetDesign(rows);
    expect(summary.entryCount).toBe(2);
    expect(summary.environmentCount).toBe(2);
  });

  it("counts an entry as shared only when present in 2+ environments", () => {
    const rows = [
      row("E1", "ENV1"),
      row("E1", "ENV2"),
      row("E2", "ENV1"), // E2 only appears in one environment
    ];
    const summary = summarizeMetDesign(rows);
    expect(summary.entryCount).toBe(2);
    expect(summary.sharedEntryCount).toBe(1);
  });

  it("never fabricates a shared entry when the design has none", () => {
    const rows = [row("E1", "ENV1"), row("E2", "ENV2"), row("E3", "ENV3")];
    const summary = summarizeMetDesign(rows);
    expect(summary.sharedEntryCount).toBe(0);
  });

  it("is empty for an empty dataset, never a fabricated count", () => {
    const summary = summarizeMetDesign([]);
    expect(summary).toEqual({
      entryCount: 0,
      environmentCount: 0,
      sharedEntryCount: 0,
    });
  });

  it("deduplicates repeated entry/environment pairs across multiple evaluations", () => {
    const rows = [
      row("E1", "ENV1", { traitValueId: "a", evaluationId: "eval-a" }),
      row("E1", "ENV1", { traitValueId: "b", evaluationId: "eval-b" }),
      row("E1", "ENV2", { traitValueId: "c", evaluationId: "eval-c" }),
    ];
    const summary = summarizeMetDesign(rows);
    expect(summary.entryCount).toBe(1);
    expect(summary.environmentCount).toBe(2);
    expect(summary.sharedEntryCount).toBe(1);
  });
});
