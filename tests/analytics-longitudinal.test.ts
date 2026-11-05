import { describe, expect, it } from "vitest";
import { computeTraitIntelligence } from "../src/lib/analytics/analysis";
import { computeCategoricalSummary } from "../src/lib/analytics/categorical";
import type { ObservationRecord } from "../src/lib/analytics/types";

const trait = {
  traitId: "trait-1",
  code: "vigor",
  name: "Vigueur",
  unit: null,
  direction: "higher_is_better",
  targetValue: null,
  dataType: "numeric" as const,
};

function row(
  partial: Partial<ObservationRecord> & { phenotypeId: string },
): ObservationRecord {
  return {
    traitId: trait.traitId,
    traitCode: trait.code,
    traitName: trait.name,
    unit: null,
    direction: trait.direction,
    targetValue: null,
    phenotypeCode: partial.phenotypeId,
    familyId: null,
    seedLotId: null,
    block: null,
    replicate: null,
    location: null,
    evaluationId: `eval-${Math.random()}`,
    evaluationDate: null,
    evaluatorId: null,
    traitValueId: `tv-${Math.random()}`,
    numericValue: 0,
    ...partial,
  };
}

describe("canonical per-occasion aggregation (task review finding #4)", () => {
  // Phenotype A: D10 has two raw observations (10 and 12 -> mean 11);
  // D20 has a single observation (30). Everything else is padding so the
  // dataset also clears the >=5-entity repeatability/within-entity
  // thresholds without affecting what this test actually checks.
  function buildRows(order: "ascending" | "shuffled"): ObservationRecord[] {
    const duplicateRows = [
      row({
        phenotypeId: "A",
        phenotypeCode: "A",
        evaluationDate: "2026-01-10",
        numericValue: 10,
        traitValueId: "a-d10-1",
        evaluationId: "eval-a-d10-1",
      }),
      row({
        phenotypeId: "A",
        phenotypeCode: "A",
        evaluationDate: "2026-01-10",
        numericValue: 12,
        traitValueId: "a-d10-2",
        evaluationId: "eval-a-d10-2",
      }),
      row({
        phenotypeId: "A",
        phenotypeCode: "A",
        evaluationDate: "2026-01-20",
        numericValue: 30,
        traitValueId: "a-d20-1",
        evaluationId: "eval-a-d20-1",
      }),
    ];
    const padding = ["B", "C", "D", "E"].map((code) =>
      row({
        phenotypeId: code,
        phenotypeCode: code,
        evaluationDate: "2026-01-10",
        numericValue: 15,
        traitValueId: `${code}-1`,
        evaluationId: `eval-${code}-1`,
      }),
    );
    const all = [...duplicateRows, ...padding];
    return order === "ascending"
      ? all
      : [all[2], all[4], all[0], all[6], all[3], all[5], all[1]];
  }

  it("averages same-phenotype/same-date duplicates into one canonical occasion", () => {
    const bundle = computeTraitIntelligence(buildRows("ascending"), trait, 0);
    const featureA = bundle.derivedFeatures.find((f) => f.phenotypeId === "A")!;
    expect(featureA.nMeasurements).toBe(2); // two distinct dates, not three raw rows
    expect(featureA.rawObservationCount).toBe(3); // but all three raw rows are accounted for
    expect(featureA.firstValue).toBeCloseTo(11, 10); // mean(10, 12)
    expect(featureA.lastValue).toBeCloseTo(30, 10);
    // AUC over the canonical series: trapezoid between (0, 11) and (10, 30).
    expect(featureA.auc.status).toBe("eligible");
    if (featureA.auc.status === "eligible") {
      expect(featureA.auc.auc).toBeCloseTo(((11 + 30) / 2) * 10, 8);
    }
  });

  it("produces identical longitudinal results regardless of raw row input order", () => {
    const ascending = computeTraitIntelligence(
      buildRows("ascending"),
      trait,
      0,
    );
    const shuffled = computeTraitIntelligence(buildRows("shuffled"), trait, 0);

    const featureA1 = ascending.derivedFeatures.find(
      (f) => f.phenotypeId === "A",
    )!;
    const featureA2 = shuffled.derivedFeatures.find(
      (f) => f.phenotypeId === "A",
    )!;
    expect(featureA2.firstValue).toBeCloseTo(featureA1.firstValue, 12);
    expect(featureA2.lastValue).toBeCloseTo(featureA1.lastValue, 12);
    expect(featureA2.nMeasurements).toBe(featureA1.nMeasurements);
    expect(featureA2.rawObservationCount).toBe(featureA1.rawObservationCount);
    expect(featureA2.auc.status).toBe(featureA1.auc.status);
    if (
      featureA1.auc.status === "eligible" &&
      featureA2.auc.status === "eligible"
    ) {
      expect(featureA2.auc.auc).toBeCloseTo(featureA1.auc.auc, 12);
    }

    // The population trajectory at D10 must count phenotype A once (its
    // canonical mean, 11), not twice (its two raw rows) - otherwise it
    // would silently carry double weight relative to every other entity.
    const d10_1 = ascending.populationTrajectory.find(
      (p) => p.date === "2026-01-10",
    )!;
    const d10_2 = shuffled.populationTrajectory.find(
      (p) => p.date === "2026-01-10",
    )!;
    expect(d10_1.n).toBe(5); // A (canonical), B, C, D, E - not 6
    expect(d10_2.n).toBe(5);
    expect(d10_2.mean).toBeCloseTo(d10_1.mean, 12);

    expect(
      ascending.entityTrajectories.find((e) => e.phenotypeId === "A")!.points,
    ).toEqual(
      shuffled.entityTrajectories.find((e) => e.phenotypeId === "A")!.points,
    );
  });
});

describe("categorical/boolean trait summaries (task §5)", () => {
  it("counts and proportions for a categorical trait, using declared allowed values as the category order baseline", () => {
    const rows = [
      {
        traitValueId: "1",
        textValue: "rouge",
        booleanValue: null,
        evaluationId: "e1",
        evaluationDate: "2026-01-01",
        phenotypeId: "p1",
        phenotypeCode: "P1",
      },
      {
        traitValueId: "2",
        textValue: "rouge",
        booleanValue: null,
        evaluationId: "e2",
        evaluationDate: "2026-01-01",
        phenotypeId: "p2",
        phenotypeCode: "P2",
      },
      {
        traitValueId: "3",
        textValue: "vert",
        booleanValue: null,
        evaluationId: "e3",
        evaluationDate: "2026-01-01",
        phenotypeId: "p3",
        phenotypeCode: "P3",
      },
    ];
    const summary = computeCategoricalSummary(
      rows,
      {
        traitId: "t1",
        code: "color",
        name: "Couleur",
        dataType: "categorical",
        allowedValues: ["rouge", "vert", "jaune"],
      },
      4,
    );
    expect(summary.nObserved).toBe(3);
    expect(summary.nEvaluationEvents).toBe(4);
    expect(summary.nEvaluationEventsWithoutTrait).toBe(1);
    expect(summary.coverageRatio).toBeCloseTo(0.75, 10);
    const byLabel = new Map(summary.categories.map((c) => [c.label, c]));
    expect(byLabel.get("rouge")?.count).toBe(2);
    expect(byLabel.get("vert")?.count).toBe(1);
    expect(byLabel.get("jaune")?.count).toBe(0); // declared but never observed - still shown at 0
    expect(byLabel.get("rouge")?.proportion).toBeCloseTo(2 / 3, 10);
  });

  it("true/false counts and proportions for a boolean trait", () => {
    const rows = [
      {
        traitValueId: "1",
        textValue: null,
        booleanValue: true,
        evaluationId: "e1",
        evaluationDate: "2026-01-01",
        phenotypeId: "p1",
        phenotypeCode: "P1",
      },
      {
        traitValueId: "2",
        textValue: null,
        booleanValue: true,
        evaluationId: "e2",
        evaluationDate: "2026-01-01",
        phenotypeId: "p2",
        phenotypeCode: "P2",
      },
      {
        traitValueId: "3",
        textValue: null,
        booleanValue: false,
        evaluationId: "e3",
        evaluationDate: "2026-01-01",
        phenotypeId: "p3",
        phenotypeCode: "P3",
      },
    ];
    const summary = computeCategoricalSummary(
      rows,
      {
        traitId: "t2",
        code: "flowered",
        name: "A fleuri",
        dataType: "boolean",
        allowedValues: null,
      },
      3,
    );
    const byLabel = new Map(summary.categories.map((c) => [c.label, c]));
    expect(byLabel.get("Oui")?.count).toBe(2);
    expect(byLabel.get("Non")?.count).toBe(1);
    expect(summary.coverageRatio).toBeCloseTo(1, 10);
  });

  it("never computes mean/SD-style statistics - the summary only exposes counts and proportions", () => {
    const summary = computeCategoricalSummary(
      [],
      {
        traitId: "t3",
        code: "x",
        name: "X",
        dataType: "categorical",
        allowedValues: ["a"],
      },
      0,
    );
    expect(Object.keys(summary)).not.toContain("mean");
    expect(Object.keys(summary)).not.toContain("sd");
  });
});
