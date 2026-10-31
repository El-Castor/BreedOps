// Pure, deterministic statistical primitives for the V2-04 Trait Analytics
// engine. Every function here is a closed-form, textbook statistic -
// nothing iterative, nothing requiring numerical optimization - so it can be
// (and is, see tests/analytics-stats.test.ts) validated against known
// reference values with ordinary floating-point tolerances. No function in
// this file ever mutates scientific source data; everything here is a pure
// computation over numbers the caller already fetched.
//
// Formula conventions (documented once, used everywhere in this module):
//  - "sample" statistics (variance, SD) use Bessel's correction (divide by
//    n-1), the standard convention for an observed sample rather than a
//    known population.
//  - Quartiles use linear interpolation between order statistics (the same
//    method as R's `quantile(type = 7)` and numpy's default
//    `percentile` / `np.quantile` without an explicit method) - the most
//    common convention, so values here are directly comparable to a
//    scientist's own R/Python analysis of the exported dataset.

export type Eligible<T> = { status: "eligible" } & T;
export type NotEstimable = { status: "not_estimable"; reasons: string[] };
export type EligibilityResult<T> = Eligible<T> | NotEstimable;

export function notEstimable(...reasons: string[]): NotEstimable {
  return { status: "not_estimable", reasons };
}

export function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

export function sampleVariance(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const ss = xs.reduce((sum, x) => sum + (x - m) ** 2, 0);
  return ss / (xs.length - 1);
}

export function sampleSd(xs: number[]): number {
  return Math.sqrt(sampleVariance(xs));
}

export function standardError(xs: number[]): number {
  return sampleSd(xs) / Math.sqrt(xs.length);
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Linear-interpolation quantile (R type 7 / numpy default). `p` in [0,1]. */
export function quantile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const position = (n - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

export function medianAbsoluteDeviation(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export type CvResult =
  | { status: "ok"; value: number }
  | { status: "not_applicable"; reason: string };

/** Coefficient of variation as a percentage, with transparent eligibility
 * rules rather than a silently misleading number (PROMPT §11 / task §11). */
export function coefficientOfVariation(xs: number[]): CvResult {
  const m = mean(xs);
  const sd = sampleSd(xs);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (m === 0) {
    return {
      status: "not_applicable",
      reason:
        "La moyenne est exactement nulle : le CV serait une division par zéro.",
    };
  }
  if (min < 0 && max > 0) {
    return {
      status: "not_applicable",
      reason:
        "Les valeurs observées changent de signe : le CV n’est pas un ratio interprétable sans une échelle de rapport cohérente.",
    };
  }
  const range = max - min;
  if (range > 0 && Math.abs(m) < 0.05 * range) {
    return {
      status: "not_applicable",
      reason:
        "La moyenne est proche de zéro par rapport à l’étendue observée : le CV serait numériquement instable et trompeur.",
    };
  }
  return { status: "ok", value: (sd / m) * 100 };
}

export type DescriptiveStats = {
  nTotal: number;
  nObserved: number;
  nMissing: number;
  mean: number;
  median: number;
  sd: number;
  variance: number;
  se: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  mad: number;
  cv: CvResult;
};

/** `nTotal` is the count of eligible rows (observed + missing) the caller
 * already knows about; `xs` holds only the non-missing numeric values. */
export function descriptiveStats(
  xs: number[],
  nTotal: number,
): DescriptiveStats {
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  return {
    nTotal,
    nObserved: xs.length,
    nMissing: nTotal - xs.length,
    mean: mean(xs),
    median: median(xs),
    sd: sampleSd(xs),
    variance: sampleVariance(xs),
    se: standardError(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    q1,
    q3,
    iqr: q3 - q1,
    mad: medianAbsoluteDeviation(xs),
    cv: coefficientOfVariation(xs),
  };
}

export type OutlierBounds = { lower: number; upper: number };

/** Tukey's fences: a transparent, well-known rule for flagging a
 * "potential outlier" - never a basis for automatic deletion (task §12). */
export function outlierBounds(q1: number, q3: number): OutlierBounds {
  const iqr = q3 - q1;
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

export function isPotentialOutlier(
  value: number,
  bounds: OutlierBounds,
): boolean {
  return value < bounds.lower || value > bounds.upper;
}

// ───────────────────────── Longitudinal ─────────────────────────

export type TimePoint = { t: number; v: number };

/** Trapezoidal area under the curve over actual elapsed time (`t` in days
 * from some common origin - the caller decides, see
 * src/lib/analytics/analysis.ts). Requires at least 2 distinct timepoints. */
export function trapezoidalAuc(
  points: TimePoint[],
): EligibilityResult<{ auc: number }> {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const distinctTimes = new Set(sorted.map((p) => p.t)).size;
  if (distinctTimes < 2) {
    return notEstimable(
      "Au moins deux dates de mesure distinctes sont nécessaires pour calculer une aire sous la courbe.",
    );
  }
  let auc = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].t - sorted[i - 1].t;
    if (dt <= 0) continue;
    auc += ((sorted[i].v + sorted[i - 1].v) / 2) * dt;
  }
  return { status: "eligible", auc };
}

export type SlopeResult = {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
};

const MIN_SLOPE_OBSERVATIONS = 3;

/** Ordinary-least-squares slope of `v` on `t` (e.g. value per elapsed day).
 * Requires enough observations AND real variability in time - a single
 * repeated date, or too few points, cannot support a trend estimate. */
export function linearSlope(
  points: TimePoint[],
): EligibilityResult<SlopeResult> {
  if (points.length < MIN_SLOPE_OBSERVATIONS) {
    return notEstimable(
      `Au moins ${MIN_SLOPE_OBSERVATIONS} mesures sont nécessaires pour estimer une pente.`,
    );
  }
  const tBar = mean(points.map((p) => p.t));
  const vBar = mean(points.map((p) => p.v));
  const ssT = points.reduce((sum, p) => sum + (p.t - tBar) ** 2, 0);
  if (ssT === 0) {
    return notEstimable(
      "Toutes les mesures partagent la même date : aucune variabilité temporelle pour estimer une pente.",
    );
  }
  const ssTV = points.reduce((sum, p) => sum + (p.t - tBar) * (p.v - vBar), 0);
  const slope = ssTV / ssT;
  const intercept = vBar - slope * tBar;
  const ssV = points.reduce((sum, p) => sum + (p.v - vBar) ** 2, 0);
  const predicted = points.map((p) => intercept + slope * p.t);
  const ssRes = points.reduce(
    (sum, p, i) => sum + (p.v - predicted[i]) ** 2,
    0,
  );
  const r2 = ssV === 0 ? 1 : 1 - ssRes / ssV;
  return { status: "eligible", slope, intercept, r2, n: points.length };
}

export type RelativeChangeResult = {
  absolute: number;
  relative: number | null;
};

export function relativeChange(
  first: number,
  last: number,
): RelativeChangeResult {
  const absolute = last - first;
  return { absolute, relative: first === 0 ? null : absolute / first };
}

// ───────────────────────── Correlation ─────────────────────────

export type CorrelationResult = { r: number; n: number };

/** Pearson correlation over paired, complete observations only - never an
 * imputed value (task §26). */
export function pearsonCorrelation(
  xs: number[],
  ys: number[],
): CorrelationResult | null {
  const n = xs.length;
  if (n !== ys.length || n < 3) return null;
  const xBar = mean(xs);
  const yBar = mean(ys);
  const sxy = xs.reduce((sum, x, i) => sum + (x - xBar) * (ys[i] - yBar), 0);
  const sxx = xs.reduce((sum, x) => sum + (x - xBar) ** 2, 0);
  const syy = ys.reduce((sum, y) => sum + (y - yBar) ** 2, 0);
  if (sxx === 0 || syy === 0) return null;
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

/** Average (fractional) ranks, the standard tie-handling convention for
 * Spearman's rho. */
function fractionalRanks(xs: number[]): number[] {
  const indexed = xs.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value)
      j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman's rank correlation: Pearson correlation of the fractional ranks. */
export function spearmanCorrelation(
  xs: number[],
  ys: number[],
): CorrelationResult | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearsonCorrelation(fractionalRanks(xs), fractionalRanks(ys));
}

// ───────────────────────── Multiple testing ─────────────────────────

export type BhResult = { index: number; p: number; q: number }[];

/** Benjamini-Hochberg false-discovery-rate adjustment. Returns one entry per
 * input p-value (by original index), each carrying its adjusted q-value;
 * order of the input is preserved in the output. */
export function benjaminiHochberg(pValues: number[]): BhResult {
  const m = pValues.length;
  const indexed = pValues.map((p, index) => ({ p, index }));
  indexed.sort((a, b) => a.p - b.p);
  const raw = indexed.map((item, rank) => (item.p * m) / (rank + 1));
  // Enforce monotonicity from the largest p-value downward (the standard
  // BH step-up adjustment), then clip to [0, 1].
  const adjusted = new Array<number>(m);
  let runningMin = Infinity;
  for (let i = m - 1; i >= 0; i--) {
    runningMin = Math.min(runningMin, raw[i]);
    adjusted[i] = Math.min(1, runningMin);
  }
  const byOriginalIndex = new Array<number>(m);
  indexed.forEach((item, rank) => {
    byOriginalIndex[item.index] = adjusted[rank];
  });
  return pValues.map((p, index) => ({ index, p, q: byOriginalIndex[index] }));
}

/** Two-sided p-value for a Pearson/Spearman correlation coefficient under
 * the standard t-distribution approximation (r converted to a t statistic
 * with n-2 degrees of freedom). Uses a numerically stable continued-fraction
 * evaluation of the regularized incomplete beta function - the same closed
 * form every statistics package uses for this exact conversion; it is not a
 * mixed/REML-style model and has no iterative optimization. */
export function correlationPValue(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return NaN;
  if (Math.abs(r) >= 1) return 0;
  const t2 = (r * r * df) / (1 - r * r);
  // P(|T| > t) for a t-distribution = incompleteBeta(df/2, 1/2, df/(df+t^2))
  const x = df / (df + t2);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/** Regularized incomplete beta function via Lentz's continued fraction
 * (Numerical Recipes §6.4) - a standard, well-tested numerical method, not
 * an invented formula. */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - logBeta) / a;
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaContinuedFraction(x, a, b);
  }
  return (
    1 -
    (Math.exp(Math.log(1 - x) * b + Math.log(x) * a - logBeta) / b) *
      betaContinuedFraction(1 - x, b, a)
  );
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 1e-12;
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function logGamma(x: number): number {
  // Lanczos approximation (g=7, n=9), standard and widely published.
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const xx = x - 1;
  let a = coefficients[0];
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += coefficients[i] / (xx + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a)
  );
}
