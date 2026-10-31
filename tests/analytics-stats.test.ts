import { describe, expect, it } from "vitest";
import {
  mean,
  sampleVariance,
  sampleSd,
  standardError,
  median,
  quantile,
  medianAbsoluteDeviation,
  coefficientOfVariation,
  descriptiveStats,
  outlierBounds,
  isPotentialOutlier,
  trapezoidalAuc,
  linearSlope,
  relativeChange,
  pearsonCorrelation,
  spearmanCorrelation,
  benjaminiHochberg,
  correlationPValue,
} from "../src/lib/analytics/stats";

// Classic textbook dataset (e.g. Wikipedia "Standard deviation" worked
// example): mean 5, sample variance 32/7, sample SD sqrt(32/7).
const classic = [2, 4, 4, 4, 5, 5, 7, 9];

describe("descriptive statistics - known reference values", () => {
  it("mean", () => {
    expect(mean(classic)).toBeCloseTo(5, 10);
  });
  it("sample variance (Bessel's correction, n-1)", () => {
    expect(sampleVariance(classic)).toBeCloseTo(32 / 7, 10);
  });
  it("sample standard deviation", () => {
    expect(sampleSd(classic)).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });
  it("standard error", () => {
    expect(standardError(classic)).toBeCloseTo(
      Math.sqrt(32 / 7) / Math.sqrt(8),
      10,
    );
  });
  it("median (even n, average of two middle values)", () => {
    expect(median(classic)).toBeCloseTo(4.5, 10);
  });
  it("quartiles via R type-7 linear interpolation", () => {
    expect(quantile(classic, 0.25)).toBeCloseTo(4, 10);
    expect(quantile(classic, 0.5)).toBeCloseTo(4.5, 10);
    expect(quantile(classic, 0.75)).toBeCloseTo(5.5, 10);
  });
  it("median absolute deviation", () => {
    // Deviations from the median (4.5): |2-4.5|=2.5, three values at 4
    // each |4-4.5|=0.5, two values at 5 each |5-4.5|=0.5, |7-4.5|=2.5,
    // |9-4.5|=4.5 -> five 0.5's, two 2.5's, one 4.5 -> median of those
    // eight deviations is 0.5.
    expect(medianAbsoluteDeviation(classic)).toBeCloseTo(0.5, 10);
  });
  it("coefficient of variation when the mean is well away from zero", () => {
    const cv = coefficientOfVariation(classic);
    expect(cv.status).toBe("ok");
    if (cv.status === "ok")
      expect(cv.value).toBeCloseTo((Math.sqrt(32 / 7) / 5) * 100, 8);
  });
  it("CV is NOT_APPLICABLE when the mean is exactly zero", () => {
    const cv = coefficientOfVariation([-2, -1, 0, 1, 2]);
    expect(cv.status).toBe("not_applicable");
  });
  it("CV is NOT_APPLICABLE when values span both signs", () => {
    const cv = coefficientOfVariation([-10, -1, 1, 10, 0.5]);
    expect(cv.status).toBe("not_applicable");
  });
  it("descriptiveStats bundles everything consistently, with nMissing from nTotal", () => {
    const stats = descriptiveStats(classic, 10);
    expect(stats.nObserved).toBe(8);
    expect(stats.nMissing).toBe(2);
    expect(stats.q1).toBeCloseTo(4, 10);
    expect(stats.q3).toBeCloseTo(5.5, 10);
    expect(stats.iqr).toBeCloseTo(1.5, 10);
  });
});

describe("Tukey outlier fences", () => {
  it("flags a value clearly beyond 1.5*IQR, not one within it", () => {
    const bounds = outlierBounds(4, 5.5);
    expect(bounds.lower).toBeCloseTo(1.75, 10);
    expect(bounds.upper).toBeCloseTo(7.75, 10);
    expect(isPotentialOutlier(9, bounds)).toBe(true);
    expect(isPotentialOutlier(2, bounds)).toBe(false);
  });
});

describe("trapezoidal AUC", () => {
  it("matches a hand-computed trapezoid area", () => {
    const result = trapezoidalAuc([
      { t: 0, v: 0 },
      { t: 1, v: 2 },
      { t: 2, v: 2 },
      { t: 3, v: 0 },
    ]);
    expect(result.status).toBe("eligible");
    if (result.status === "eligible") expect(result.auc).toBeCloseTo(4, 10);
  });
  it("is NOT_ESTIMABLE with fewer than two distinct timepoints", () => {
    const result = trapezoidalAuc([{ t: 0, v: 1 }]);
    expect(result.status).toBe("not_estimable");
  });
});

describe("linear slope (OLS)", () => {
  it("recovers the exact slope/intercept of a perfect line", () => {
    const result = linearSlope([
      { t: 0, v: 1 },
      { t: 1, v: 3 },
      { t: 2, v: 5 },
      { t: 3, v: 7 },
      { t: 4, v: 9 },
    ]);
    expect(result.status).toBe("eligible");
    if (result.status === "eligible") {
      expect(result.slope).toBeCloseTo(2, 10);
      expect(result.intercept).toBeCloseTo(1, 10);
      expect(result.r2).toBeCloseTo(1, 10);
    }
  });
  it("is NOT_ESTIMABLE with fewer than 3 observations", () => {
    const result = linearSlope([
      { t: 0, v: 1 },
      { t: 1, v: 2 },
    ]);
    expect(result.status).toBe("not_estimable");
  });
  it("is NOT_ESTIMABLE when every observation shares the same date", () => {
    const result = linearSlope([
      { t: 5, v: 1 },
      { t: 5, v: 2 },
      { t: 5, v: 3 },
    ]);
    expect(result.status).toBe("not_estimable");
  });
});

describe("relative change", () => {
  it("computes a normal relative change", () => {
    const result = relativeChange(10, 15);
    expect(result.absolute).toBeCloseTo(5, 10);
    expect(result.relative).toBeCloseTo(0.5, 10);
  });
  it("returns null relative change for a zero denominator, keeping the absolute value", () => {
    const result = relativeChange(0, 5);
    expect(result.absolute).toBeCloseTo(5, 10);
    expect(result.relative).toBeNull();
  });
});

describe("correlation", () => {
  it("Pearson r = 1 for a perfect positive line", () => {
    const result = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(result?.r).toBeCloseTo(1, 10);
    expect(result?.n).toBe(5);
  });
  it("Pearson r = -1 for a perfect negative line", () => {
    const result = pearsonCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(result?.r).toBeCloseTo(-1, 10);
  });
  it("Pearson returns null with fewer than 3 paired observations", () => {
    expect(pearsonCorrelation([1, 2], [1, 2])).toBeNull();
  });
  it("Pearson returns null when one series has zero variance", () => {
    expect(pearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
  it("Spearman rho = 1 when tied ranks line up identically (fractional-rank tie handling)", () => {
    const result = spearmanCorrelation([1, 2, 2, 3], [10, 20, 20, 30]);
    expect(result?.r).toBeCloseTo(1, 10);
  });
  it("Spearman returns null with fewer than 3 paired observations", () => {
    expect(spearmanCorrelation([1, 2], [1, 2])).toBeNull();
  });
});

describe("Benjamini-Hochberg FDR correction", () => {
  it("matches the standard worked example (10 p-values)", () => {
    const pValues = [0.005, 0.011, 0.02, 0.04, 0.13, 0.26, 0.5, 0.7, 0.9, 0.99];
    const result = benjaminiHochberg(pValues);
    const expected = [
      0.05,
      0.055,
      0.2 / 3,
      0.1,
      0.26,
      13 / 30,
      5 / 7,
      0.875,
      0.99,
      0.99,
    ];
    result.forEach((r, i) => expect(r.q).toBeCloseTo(expected[i], 6));
  });
  it("all-equal raw BH scores when p-values are evenly spaced (sanity case)", () => {
    const result = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05]);
    result.forEach((r) => expect(r.q).toBeCloseTo(0.05, 10));
  });
  it("preserves input order in its output", () => {
    const result = benjaminiHochberg([0.5, 0.01, 0.3]);
    expect(result.map((r) => r.p)).toEqual([0.5, 0.01, 0.3]);
  });
});

describe("correlation p-value (two-sided t-distribution approximation)", () => {
  it("is close to 0 for a strong correlation with a reasonable sample size", () => {
    // r = 0.9, n = 20 -> t = r*sqrt((n-2)/(1-r^2)) ~ 8.68, df = 18: a very
    // small two-sided p-value (known to be well under 0.001 for this t/df).
    const p = correlationPValue(0.9, 20);
    expect(p).toBeLessThan(0.001);
    expect(p).toBeGreaterThan(0);
  });
  it("is close to 1 for a near-zero correlation", () => {
    const p = correlationPValue(0.01, 20);
    expect(p).toBeGreaterThan(0.9);
  });
  it("is exactly 0 when r is +/-1 (perfect correlation)", () => {
    expect(correlationPValue(1, 10)).toBe(0);
    expect(correlationPValue(-1, 10)).toBe(0);
  });
});
