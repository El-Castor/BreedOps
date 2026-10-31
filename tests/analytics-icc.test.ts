import { describe, expect, it } from "vitest";
import {
  estimateRepeatability,
  MIN_ICC_ENTITIES,
} from "../src/lib/analytics/icc";

describe("repeatability (ICC) - one-way random-effects ANOVA", () => {
  it("balanced dataset: matches the hand-derived closed-form ICC exactly", () => {
    // 5 entities x 3 observations, each entity offset by exactly ±1 from its
    // own mean, entity means spaced 10 apart: MSamong=750, MSwithin=1,
    // n0=3 (balanced => n0 equals the common group size) =>
    // ICC = (750-1)/(750+(3-1)*1) = 749/752.
    const groups = [
      [10, 11, 9],
      [20, 21, 19],
      [30, 31, 29],
      [40, 41, 39],
      [50, 51, 49],
    ];
    const result = estimateRepeatability(groups);
    expect(result.status).toBe("eligible");
    if (result.status === "eligible") {
      expect(result.icc).toBeCloseTo(749 / 752, 8);
      expect(result.nEntities).toBe(5);
      expect(result.nObservations).toBe(15);
      expect(result.ciLow).toBeLessThanOrEqual(result.icc);
      expect(result.ciHigh).toBeGreaterThanOrEqual(result.icc);
    }
  });

  it("unbalanced dataset: matches the hand-derived closed-form ICC with Searle's n0 adjustment", () => {
    // 5 entities with unequal replication (2,3,2,4,3 observations). By hand:
    // SSwithin = 8+2+0+8+8 = 26, dfWithin = 9 -> MSwithin = 26/9.
    // Grand mean = 266/14 = 19 exactly; group means 10,10,20,20,32 ->
    // SSamong = 162+243+2+4+507 = 918, dfAmong = 4 -> MSamong = 229.5.
    // n0 = (14 - 42/14)/4 = 11/4 = 2.75.
    // ICC = (MSamong-MSwithin)/(MSamong+(n0-1)*MSwithin)
    //     = (4079/18)/(4222/18) = 4079/4222 ≈ 0.966130.
    const groups = [
      [8, 12],
      [9, 10, 11],
      [20, 20],
      [18, 22, 20, 20],
      [30, 34, 32],
    ];
    const result = estimateRepeatability(groups);
    expect(result.status).toBe("eligible");
    if (result.status === "eligible") {
      expect(result.icc).toBeCloseTo(4079 / 4222, 6);
      expect(result.nEntities).toBe(5);
      expect(result.nObservations).toBe(14);
    }
  });

  it("zero-variance dataset (every observation identical): NOT_ESTIMABLE, not a fabricated number", () => {
    const groups = Array.from({ length: 6 }, () => [7, 7]);
    const result = estimateRepeatability(groups);
    expect(result.status).toBe("not_estimable");
  });

  it("insufficient-repeat dataset (fewer than the minimum entities): NOT_ESTIMABLE with a stated reason", () => {
    const groups = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    expect(groups.length).toBeLessThan(MIN_ICC_ENTITIES);
    const result = estimateRepeatability(groups);
    expect(result.status).toBe("not_estimable");
    if (result.status === "not_estimable") {
      expect(result.reasons.join(" ")).toMatch(/entités/);
    }
  });

  it("entities with only one observation are excluded from the model rather than biasing it", () => {
    const groups = [
      [10, 11],
      [20, 21],
      [30, 31],
      [40, 41],
      [50, 51],
      [999], // a single-observation entity: must not count toward eligibility
    ];
    const result = estimateRepeatability(groups);
    expect(result.status).toBe("eligible");
    if (result.status === "eligible") {
      expect(result.nEntities).toBe(5);
      expect(result.nObservations).toBe(10);
    }
  });

  it("the bootstrap confidence interval is exactly reproducible from its persisted seed", () => {
    const groups = [
      [10, 11, 9],
      [20, 21, 19],
      [30, 31, 29],
      [40, 41, 39],
      [50, 51, 49],
    ];
    const first = estimateRepeatability(groups);
    const second = estimateRepeatability(groups);
    expect(first.status).toBe("eligible");
    expect(second.status).toBe("eligible");
    if (first.status === "eligible" && second.status === "eligible") {
      expect(first.ciLow).toBe(second.ciLow);
      expect(first.ciHigh).toBe(second.ciHigh);
      expect(first.bootstrapSeed).toBe(second.bootstrapSeed);
    }
  });
});
