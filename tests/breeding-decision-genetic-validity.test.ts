import { describe, expect, it } from "vitest";
import {
  buildGeneticValidityPanel,
  computeBroadSenseHeritability,
} from "../src/lib/breeding-decision/genetic-validity";

describe("computeBroadSenseHeritability", () => {
  it("blocks when not every candidate is explicitly scientific_role='genotype'", () => {
    const result = computeBroadSenseHeritability({
      allCandidatesAreGenotypeRole: false,
      entryVariance: 4,
      entryByEnvironmentVariance: 1,
      residualVariance: 2,
      nEnvironments: 3,
      averageReplication: 2,
    });
    expect(result.status).toBe("NOT_ESTIMABLE");
    expect((result as { reason: string }).reason).toContain(
      "scientific_role='genotype'",
    );
  });

  it("computes H2 with the standard entry-mean broad-sense formula", () => {
    // H2 = 4 / (4 + 1/3 + 2/(3*2)) = 4 / (4 + 0.3333 + 0.3333) = 4/4.6667 = 0.857
    const result = computeBroadSenseHeritability({
      allCandidatesAreGenotypeRole: true,
      entryVariance: 4,
      entryByEnvironmentVariance: 1,
      residualVariance: 2,
      nEnvironments: 3,
      averageReplication: 2,
    });
    expect(result.status).toBe("ESTIMABLE");
    expect((result as { h2: number }).h2).toBeCloseTo(0.857, 2);
  });

  it("blocks when entry or residual variance is not estimable", () => {
    const result = computeBroadSenseHeritability({
      allCandidatesAreGenotypeRole: true,
      entryVariance: null,
      entryByEnvironmentVariance: 1,
      residualVariance: 2,
      nEnvironments: 3,
      averageReplication: 2,
    });
    expect(result.status).toBe("NOT_ESTIMABLE");
  });

  it("blocks when entry variance is zero or negative", () => {
    const result = computeBroadSenseHeritability({
      allCandidatesAreGenotypeRole: true,
      entryVariance: 0,
      entryByEnvironmentVariance: 1,
      residualVariance: 2,
      nEnvironments: 3,
      averageReplication: 2,
    });
    expect(result.status).toBe("NOT_ESTIMABLE");
  });

  it("treats a null entry x environment variance as zero, not a blocker", () => {
    const result = computeBroadSenseHeritability({
      allCandidatesAreGenotypeRole: true,
      entryVariance: 4,
      entryByEnvironmentVariance: null,
      residualVariance: 2,
      nEnvironments: 3,
      averageReplication: 2,
    });
    expect(result.status).toBe("ESTIMABLE");
  });
});

describe("buildGeneticValidityPanel", () => {
  it("always reports additive breeding value and expected additive gain as NOT_ESTIMABLE", () => {
    const panel = buildGeneticValidityPanel({
      candidateRankingAvailable: true,
      multiEnvironmentStabilityAvailable: true,
      heritability: { status: "ESTIMABLE", h2: 0.8 },
    });
    expect(panel.additiveBreedingValue.status).toBe("NOT_ESTIMABLE");
    expect(panel.expectedAdditiveGain.status).toBe("NOT_ESTIMABLE");
    expect(panel.additiveBreedingValue.reason).toBeTruthy();
    expect(panel.expectedAdditiveGain.reason).toBeTruthy();
  });

  it("always reports genetic correlation as NOT_ESTIMABLE (multi-trait covariance model deferred)", () => {
    const panel = buildGeneticValidityPanel({
      candidateRankingAvailable: true,
      multiEnvironmentStabilityAvailable: true,
      heritability: null,
    });
    expect(panel.geneticCorrelation.status).toBe("NOT_ESTIMABLE");
  });

  it("reports selectionDifferential as always AVAILABLE", () => {
    const panel = buildGeneticValidityPanel({
      candidateRankingAvailable: false,
      multiEnvironmentStabilityAvailable: false,
      heritability: null,
    });
    expect(panel.selectionDifferential.status).toBe("AVAILABLE");
    expect(panel.selectionDifferential.reason).toBeNull();
  });

  it("reports broadSenseGenotypicResponse as AVAILABLE only when heritability is ESTIMABLE", () => {
    const available = buildGeneticValidityPanel({
      candidateRankingAvailable: true,
      multiEnvironmentStabilityAvailable: true,
      heritability: { status: "ESTIMABLE", h2: 0.5 },
    });
    expect(available.broadSenseGenotypicResponse.status).toBe("AVAILABLE");

    const blocked = buildGeneticValidityPanel({
      candidateRankingAvailable: true,
      multiEnvironmentStabilityAvailable: true,
      heritability: { status: "NOT_ESTIMABLE", reason: "test reason" },
    });
    expect(blocked.broadSenseGenotypicResponse.status).toBe("NOT_ESTIMABLE");
    expect(blocked.broadSenseGenotypicResponse.reason).toBe("test reason");
  });

  it("propagates candidateRanking/multiEnvironmentStability availability flags", () => {
    const panel = buildGeneticValidityPanel({
      candidateRankingAvailable: false,
      multiEnvironmentStabilityAvailable: false,
      heritability: null,
    });
    expect(panel.candidateRanking.status).toBe("NOT_ESTIMABLE");
    expect(panel.multiEnvironmentStability.status).toBe("NOT_ESTIMABLE");
  });
});
