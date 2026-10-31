// Repeatability (intraclass correlation, ICC) via the classical one-way
// random-effects ANOVA method (Lessells & Boag 1987; Searle 1971 for the
// unbalanced-data adjustment). This is deliberately NOT a general-purpose
// mixed-model/REML implementation: a repeated-measures repeatability model
// with a single random intercept and no fixed effects has an exact,
// closed-form solution from ordinary sums of squares - there is nothing to
// iterate or optimize, and this is the same formula R's `irr::icc`,
// `psych::ICC` and the single-random-effect case of `rptR` all use. See
// docs/ANALYTICS.md "Why not a Python/REML engine" for the full
// architecture decision this follows.
//
// Eligibility is evaluated BEFORE the model ever runs (task §20/§31): an
// entity with only one observation cannot inform within-entity variance and
// is excluded from the model rather than silently biasing it.

import { mean, type EligibilityResult, notEstimable } from "./stats";

export const MIN_ICC_ENTITIES = 5;
export const MIN_ICC_OBSERVATIONS_PER_ENTITY = 2;

export type IccResult = {
  icc: number;
  ciLow: number;
  ciHigh: number;
  ciMethod: string;
  bootstrapSeed: number;
  nEntities: number;
  nObservations: number;
  model: string;
  msAmong: number;
  msWithin: number;
};

function anovaIcc(
  groups: number[][],
): { icc: number; msAmong: number; msWithin: number } | null {
  const k = groups.length;
  const n = groups.reduce((sum, g) => sum + g.length, 0);
  if (k < 2 || n <= k) return null;
  const grandMean = mean(groups.flat());
  let ssAmong = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const groupMean = mean(g);
    ssAmong += g.length * (groupMean - grandMean) ** 2;
    for (const x of g) ssWithin += (x - groupMean) ** 2;
  }
  const dfAmong = k - 1;
  const dfWithin = n - k;
  const msAmong = ssAmong / dfAmong;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const sumNi2 = groups.reduce((sum, g) => sum + g.length * g.length, 0);
  const n0 = (n - sumNi2 / n) / dfAmong;
  const denominator = msAmong + (n0 - 1) * msWithin;
  const icc = denominator === 0 ? 0 : (msAmong - msWithin) / denominator;
  return { icc, msAmong, msWithin };
}

/** Deterministic PRNG (mulberry32) so a bootstrap CI is exactly reproducible
 * from its persisted seed (task §43: "if any randomness is used, seed must
 * be explicit and persisted"). */
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cluster (entity-level) bootstrap percentile 95% CI: resampling whole
 * entities with replacement is the standard non-parametric approach for an
 * ICC's sampling distribution (the same method the `rptR` R package offers
 * for non-Gaussian repeatability), and needs no special-function inverse
 * CDF - only the same closed-form ANOVA formula re-applied. */
function bootstrapCi(
  groups: number[][],
  seed: number,
  iterations: number,
): { low: number; high: number } {
  const random = mulberry32(seed);
  const estimates: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const resampled: number[][] = [];
    for (let i = 0; i < groups.length; i++) {
      resampled.push(groups[Math.floor(random() * groups.length)]);
    }
    const result = anovaIcc(resampled);
    if (result) estimates.push(result.icc);
  }
  estimates.sort((a, b) => a - b);
  const at = (p: number) =>
    estimates[Math.min(estimates.length - 1, Math.floor(p * estimates.length))];
  return { low: at(0.025), high: at(0.975) };
}

const BOOTSTRAP_ITERATIONS = 1000;
const BOOTSTRAP_SEED = 20260401;

/** `groups` is one array of numeric observations per biological entity
 * (phenotype_id), already filtered to the trait being analyzed. */
export function estimateRepeatability(
  groups: number[][],
): EligibilityResult<IccResult> {
  const eligible = groups.filter(
    (g) => g.length >= MIN_ICC_OBSERVATIONS_PER_ENTITY,
  );
  if (eligible.length < MIN_ICC_ENTITIES) {
    return notEstimable(
      `Au moins ${MIN_ICC_ENTITIES} entités mesurées à ${MIN_ICC_OBSERVATIONS_PER_ENTITY} reprises ou plus sont nécessaires (trouvé : ${eligible.length}).`,
    );
  }
  const totalObservations = eligible.reduce((sum, g) => sum + g.length, 0);
  const anova = anovaIcc(eligible);
  if (!anova) {
    return notEstimable(
      "Le modèle à un facteur n’a pas pu être ajusté sur ces données.",
    );
  }
  if (anova.msAmong === 0 && anova.msWithin === 0) {
    return notEstimable(
      "Variance nulle entre et au sein des entités : la répétabilité n’est pas définie.",
    );
  }
  const ci = bootstrapCi(eligible, BOOTSTRAP_SEED, BOOTSTRAP_ITERATIONS);
  return {
    status: "eligible",
    icc: anova.icc,
    ciLow: ci.low,
    ciHigh: ci.high,
    ciMethod: `bootstrap percentile (resampling des entités, ${BOOTSTRAP_ITERATIONS} répétitions, graine ${BOOTSTRAP_SEED})`,
    bootstrapSeed: BOOTSTRAP_SEED,
    nEntities: eligible.length,
    nObservations: totalObservations,
    model:
      "ANOVA à un facteur aléatoire (intra-entité), correction de Searle (1971) pour données non équilibrées",
    msAmong: anova.msAmong,
    msWithin: anova.msWithin,
  };
}
