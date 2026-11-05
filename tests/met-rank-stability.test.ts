import { describe, expect, it } from "vitest";
import {
  computeEnvironmentRankStability,
  MIN_SHARED_ENTRIES_FOR_RANK_PAIR,
} from "../src/lib/met/rank-stability";
import type { MetObservationRecord } from "../src/lib/met/types";

const row = (
  entryId: string,
  environmentId: string,
  numericValue: number,
): MetObservationRecord => ({
  traitValueId: `${entryId}-${environmentId}-${Math.random()}`,
  numericValue,
  evaluationId: `eval-${entryId}-${environmentId}-${Math.random()}`,
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
});

describe("computeEnvironmentRankStability", () => {
  it("reports rho=1 and no crossover when ranking is identical across environments (pure scale effect)", () => {
    // Same relative order in both environments, ENV2 just scaled up.
    const rows = [
      row("E1", "ENV1", 10),
      row("E2", "ENV1", 20),
      row("E3", "ENV1", 30),
      row("E1", "ENV2", 15),
      row("E2", "ENV2", 25),
      row("E3", "ENV2", 35),
    ];
    const pairs = computeEnvironmentRankStability(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].rho).toBeCloseTo(1, 6);
    expect(pairs[0].topEntryA).toBe("E3");
    expect(pairs[0].topEntryB).toBe("E3");
    expect(pairs[0].topEntryChanged).toBe(false);
  });

  it("detects a true crossover: the top entry changes and rho is negative", () => {
    const rows = [
      row("E1", "ENV1", 30), // best in ENV1
      row("E2", "ENV1", 20),
      row("E3", "ENV1", 10), // worst in ENV1
      row("E1", "ENV2", 10), // worst in ENV2
      row("E2", "ENV2", 20),
      row("E3", "ENV2", 30), // best in ENV2
    ];
    const pairs = computeEnvironmentRankStability(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].rho).toBeCloseTo(-1, 6);
    expect(pairs[0].topEntryA).toBe("E1");
    expect(pairs[0].topEntryB).toBe("E3");
    expect(pairs[0].topEntryChanged).toBe(true);
  });

  it("averages multiple replicates within the same entry x environment cell before ranking", () => {
    const rows = [
      row("E1", "ENV1", 8),
      row("E1", "ENV1", 12), // mean 10
      row("E2", "ENV1", 20),
      row("E1", "ENV2", 10),
      row("E2", "ENV2", 20),
    ];
    const pairs = computeEnvironmentRankStability(rows);
    expect(pairs[0].topEntryA).toBe("E2");
  });

  it(`reports insufficientN (never a fabricated rho) with fewer than ${MIN_SHARED_ENTRIES_FOR_RANK_PAIR} shared entries`, () => {
    const rows = [row("E1", "ENV1", 1), row("E1", "ENV2", 2)];
    const pairs = computeEnvironmentRankStability(rows);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].insufficientN).toBe(true);
    expect(pairs[0].rho).toBeNull();
    // The literal top-entry signal is still reported even when rho can't
    // be computed - it needs only 1 entry per environment, not 3.
    expect(pairs[0].topEntryA).toBe("E1");
  });

  it("reports one pair per combination for more than 2 environments, never omitting a pair", () => {
    const rows = [
      row("E1", "ENV1", 1),
      row("E2", "ENV1", 2),
      row("E3", "ENV1", 3),
      row("E1", "ENV2", 1),
      row("E2", "ENV2", 2),
      row("E3", "ENV2", 3),
      row("E1", "ENV3", 1),
      row("E2", "ENV3", 2),
      row("E3", "ENV3", 3),
    ];
    const pairs = computeEnvironmentRankStability(rows);
    // C(3,2) = 3 pairs for 3 environments.
    expect(pairs).toHaveLength(3);
  });

  it("returns no pairs for a single environment", () => {
    const rows = [row("E1", "ENV1", 1), row("E2", "ENV1", 2)];
    expect(computeEnvironmentRankStability(rows)).toEqual([]);
  });
});
