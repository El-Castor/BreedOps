// Orchestrates the single-trait "Trait Intelligence" bundle (task §30) from
// an already-fetched ObservationRecord[] (task §7's canonical dataset).
// Nothing here queries the database - see dataset.ts for that - and nothing
// here ever writes back to scientific source data (task §8). The caller
// (src/app/app/analytics/actions.ts) must have already checked the dataset
// is not DATASET_TOO_LARGE before calling computeTraitIntelligence: this
// module always treats whatever rows it receives as the complete, true
// filtered dataset.

import {
  descriptiveStats,
  outlierBounds,
  isPotentialOutlier,
  linearSlope,
  trapezoidalAuc,
  relativeChange,
  spearmanCorrelation,
  sampleSd,
  coefficientOfVariation,
  mean,
} from "./stats";
import { estimateTraitRepeatability } from "./icc";
import {
  HERITABILITY_NOT_ESTIMABLE_REASONS,
  MAX_INDIVIDUAL_TRAJECTORIES,
  MAX_RANK_STABILITY_TIMEPOINTS,
  MIN_RANK_STABILITY_PAIRED_N,
  MIN_WITHIN_ENTITY_OBSERVATIONS,
} from "./eligibility";
import type {
  AnalysisWarning,
  DerivedLongitudinalFeature,
  EntityTrajectory,
  ObservationRecord,
  OutlierRow,
  PopulationTrajectoryPoint,
  QualityControl,
  RankStabilityPair,
  TraitIntelligenceBundle,
  TrajectoryPoint,
  WithinEntityStability,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSinceEpoch(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime() / MS_PER_DAY;
}

function groupByPhenotype(
  rows: ObservationRecord[],
): Map<string, ObservationRecord[]> {
  const groups = new Map<string, ObservationRecord[]>();
  for (const row of rows) {
    const list = groups.get(row.phenotypeId) ?? [];
    list.push(row);
    groups.set(row.phenotypeId, list);
  }
  return groups;
}

/** Canonical per-occasion observation: every (phenotypeId, evaluationDate)
 * pair collapses to exactly one entry, its value the arithmetic mean of
 * however many raw rows shared that pair (task review finding #4 - "D10
 * values 10 and 12" must average to one occasion, deterministically,
 * regardless of which raw row the database happened to return first).
 * Undated rows (evaluationDate === null) are never merged with anything -
 * there is no date key to group them by - and are simply omitted here,
 * exactly like the longitudinal functions below already excluded them
 * before this helper existed. Used consistently for every longitudinal
 * calculation: population trajectory, individual trajectories, AUC,
 * first/last value, absolute/relative change, and rank stability. Raw
 * observations remain untouched for QC and for repeatability (ICC
 * measures within-entity variance INCLUDING true replicate measurements,
 * so collapsing them first would defeat its purpose). */
type CanonicalPoint = {
  phenotypeId: string;
  phenotypeCode: string;
  date: string;
  value: number;
  rawCount: number;
};

function canonicalizeByOccasion(rows: ObservationRecord[]): CanonicalPoint[] {
  const groups = new Map<
    string,
    {
      phenotypeId: string;
      phenotypeCode: string;
      date: string;
      values: number[];
    }
  >();
  for (const row of rows) {
    if (!row.evaluationDate) continue;
    const key = `${row.phenotypeId}\u0000${row.evaluationDate}`;
    const entry = groups.get(key) ?? {
      phenotypeId: row.phenotypeId,
      phenotypeCode: row.phenotypeCode,
      date: row.evaluationDate,
      values: [],
    };
    entry.values.push(row.numericValue);
    groups.set(key, entry);
  }
  return [...groups.values()]
    .map((g) => ({
      phenotypeId: g.phenotypeId,
      phenotypeCode: g.phenotypeCode,
      date: g.date,
      value: mean(g.values),
      rawCount: g.values.length,
    }))
    .sort((a, b) =>
      a.phenotypeId === b.phenotypeId
        ? a.date < b.date
          ? -1
          : a.date > b.date
            ? 1
            : 0
        : a.phenotypeId < b.phenotypeId
          ? -1
          : 1,
    );
}

function groupCanonicalByPhenotype(
  points: CanonicalPoint[],
): Map<string, CanonicalPoint[]> {
  const groups = new Map<string, CanonicalPoint[]>();
  for (const point of points) {
    const list = groups.get(point.phenotypeId) ?? [];
    list.push(point);
    groups.set(point.phenotypeId, list);
  }
  return groups;
}

function buildHistogram(
  values: number[],
  binCount = 10,
): QualityControl["histogram"] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max)
    return [{ binStart: min, binEnd: max, count: values.length }];
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    binStart: min + i * width,
    binEnd: min + (i + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index].count++;
  }
  return bins;
}

function buildQc(
  rows: ObservationRecord[],
  bounds: { lower: number; upper: number },
): QualityControl {
  const outliers: OutlierRow[] = rows
    .filter((row) => isPotentialOutlier(row.numericValue, bounds))
    .map((row) => ({
      phenotypeId: row.phenotypeId,
      phenotypeCode: row.phenotypeCode,
      value: row.numericValue,
      evaluationId: row.evaluationId,
      evaluationDate: row.evaluationDate,
      block: row.block,
      replicate: row.replicate,
      familyId: row.familyId,
      seedLotId: row.seedLotId,
    }));
  return {
    outliers,
    bounds,
    histogram: buildHistogram(rows.map((r) => r.numericValue)),
  };
}

/** Population trajectory from the CANONICAL series: an entity with a
 * duplicated same-date raw observation must count once per date, not
 * twice, or it would silently carry double weight in that date's mean/
 * median/quartiles (task review finding #4 applies here too, not only to
 * individual entities). */
function buildPopulationTrajectory(
  canonical: CanonicalPoint[],
): PopulationTrajectoryPoint[] {
  const byDate = new Map<string, number[]>();
  for (const point of canonical) {
    const list = byDate.get(point.date) ?? [];
    list.push(point.value);
    byDate.set(point.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, values]) => {
      const stats = descriptiveStats(values, values.length);
      return {
        date,
        n: values.length,
        mean: stats.mean,
        median: stats.median,
        q1: stats.q1,
        q3: stats.q3,
      };
    });
}

function buildEntityTrajectories(
  canonicalGroups: Map<string, CanonicalPoint[]>,
): {
  trajectories: EntityTrajectory[];
  truncated: boolean;
} {
  const phenotypeIds = [...canonicalGroups.keys()].sort((a, b) => {
    const codeA = canonicalGroups.get(a)![0].phenotypeCode;
    const codeB = canonicalGroups.get(b)![0].phenotypeCode;
    return codeA < codeB ? -1 : codeA > codeB ? 1 : 0;
  });
  const truncated = phenotypeIds.length > MAX_INDIVIDUAL_TRAJECTORIES;
  const selected = phenotypeIds.slice(0, MAX_INDIVIDUAL_TRAJECTORIES);
  const trajectories = selected.map((phenotypeId) => {
    const points = [...canonicalGroups.get(phenotypeId)!].sort((a, b) =>
      a.date < b.date ? -1 : 1,
    );
    return {
      phenotypeId,
      phenotypeCode: points[0].phenotypeCode,
      points: points.map(
        (p): TrajectoryPoint => ({
          date: p.date,
          value: p.value,
          rawCount: p.rawCount,
        }),
      ),
    };
  });
  return { trajectories, truncated };
}

function buildDerivedFeatures(
  canonicalGroups: Map<string, CanonicalPoint[]>,
): DerivedLongitudinalFeature[] {
  const features: DerivedLongitudinalFeature[] = [];
  for (const [phenotypeId, points] of canonicalGroups) {
    if (points.length === 0) continue;
    const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const timePoints = sorted.map((p) => ({
      t: daysSinceEpoch(p.date),
      v: p.value,
    }));
    const change = relativeChange(first.value, last.value);
    features.push({
      phenotypeId,
      phenotypeCode: sorted[0].phenotypeCode,
      firstValue: first.value,
      lastValue: last.value,
      firstDate: first.date,
      lastDate: last.date,
      absoluteChange: change.absolute,
      relativeChange: change.relative,
      auc: trapezoidalAuc(timePoints),
      slope: linearSlope(timePoints),
      nMeasurements: sorted.length,
      rawObservationCount: sorted.reduce((sum, p) => sum + p.rawCount, 0),
      spanDays: timePoints[timePoints.length - 1].t - timePoints[0].t,
    });
  }
  return features;
}

function buildRankStability(canonical: CanonicalPoint[]): RankStabilityPair[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const point of canonical) {
    const map = byDate.get(point.date) ?? new Map<string, number>();
    map.set(point.phenotypeId, point.value);
    byDate.set(point.date, map);
  }
  const timepoints = [...byDate.entries()]
    .sort(([, a], [, b]) => b.size - a.size)
    .slice(0, MAX_RANK_STABILITY_TIMEPOINTS)
    .map(([date]) => date)
    .sort();

  const pairs: RankStabilityPair[] = [];
  for (let i = 0; i < timepoints.length; i++) {
    for (let j = i + 1; j < timepoints.length; j++) {
      const dateA = timepoints[i];
      const dateB = timepoints[j];
      const mapA = byDate.get(dateA)!;
      const mapB = byDate.get(dateB)!;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [phenotypeId, valueA] of mapA) {
        const valueB = mapB.get(phenotypeId);
        if (valueB != null) {
          xs.push(valueA);
          ys.push(valueB);
        }
      }
      if (xs.length < MIN_RANK_STABILITY_PAIRED_N) {
        pairs.push({
          dateA,
          dateB,
          pairedN: xs.length,
          rho: null,
          insufficientN: true,
        });
        continue;
      }
      const result = spearmanCorrelation(xs, ys);
      pairs.push({ dateA, dateB, pairedN: xs.length, rho: result?.r ?? null });
    }
  }
  return pairs;
}

/** SD/CV/range are computed over RAW observations - like repeatability,
 * they describe measurement-level variability, where a genuine duplicate
 * measurement is real information about noise, not something to average
 * away. The entity's own slope, by contrast, uses the CANONICAL series
 * (consistent with every other trend/trajectory calculation in this file)
 * so one entity never carries two different, contradictory slope values
 * depending on which function computed it. */
function buildWithinEntityStability(
  rawGroups: Map<string, ObservationRecord[]>,
  canonicalGroups: Map<string, CanonicalPoint[]>,
): WithinEntityStability[] {
  const result: WithinEntityStability[] = [];
  for (const [phenotypeId, rows] of rawGroups) {
    if (rows.length < MIN_WITHIN_ENTITY_OBSERVATIONS) continue;
    const values = rows.map((r) => r.numericValue);
    const canonicalPoints = [...(canonicalGroups.get(phenotypeId) ?? [])].sort(
      (a, b) => (a.date < b.date ? -1 : 1),
    );
    const dated = canonicalPoints.map((p) => ({
      t: daysSinceEpoch(p.date),
      v: p.value,
    }));
    result.push({
      phenotypeId,
      phenotypeCode: rows[0].phenotypeCode,
      n: values.length,
      sd: sampleSd(values),
      cv: coefficientOfVariation(values),
      range: Math.max(...values) - Math.min(...values),
      slope: linearSlope(dated),
    });
  }
  return result;
}

function buildWarnings(
  rows: ObservationRecord[],
  nEvaluationEventsWithoutTrait: number,
  nEvaluationEvents: number,
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  const uncoveredRate =
    nEvaluationEvents > 0
      ? nEvaluationEventsWithoutTrait / nEvaluationEvents
      : 0;
  if (uncoveredRate > 0.3) {
    warnings.push({
      level: "caution",
      message: `Couverture d’observation limitée : ${((1 - uncoveredRate) * 100).toFixed(1)} % des événements d’évaluation de cette cohorte portent une valeur pour ce trait. L’absence de valeur ne prouve pas une mesure manquante - le trait peut simplement n’avoir pas été programmé pour les autres évaluations.`,
    });
  }
  if (rows.length > 0) {
    const values = rows.map((r) => r.numericValue);
    if (new Set(values).size === 1) {
      warnings.push({
        level: "caution",
        message:
          "Variance nulle : toutes les observations partagent exactement la même valeur.",
      });
    }
  }
  const distinctEntities = new Set(rows.map((r) => r.phenotypeId)).size;
  if (distinctEntities > 0 && distinctEntities < 5) {
    warnings.push({
      level: "caution",
      message: `Échantillon de petite taille (${distinctEntities} entités) : les estimations sont peu précises.`,
    });
  }
  return warnings;
}

export function computeTraitIntelligence(
  rows: ObservationRecord[],
  trait: {
    traitId: string;
    code: string;
    name: string;
    unit: string | null;
    direction: string;
    targetValue: number | null;
    dataType: "numeric" | "integer" | "ordinal";
  },
  nEvaluationEvents: number,
): TraitIntelligenceBundle {
  const values = rows.map((r) => r.numericValue);
  const descriptive = descriptiveStats(values, nEvaluationEvents);
  const bounds = outlierBounds(descriptive.q1, descriptive.q3);
  const qc = buildQc(rows, bounds);
  const rawGroups = groupByPhenotype(rows);
  const canonical = canonicalizeByOccasion(rows);
  const canonicalGroups = groupCanonicalByPhenotype(canonical);

  return {
    traitId: trait.traitId,
    traitCode: trait.code,
    traitName: trait.name,
    unit: trait.unit,
    direction: trait.direction,
    targetValue: trait.targetValue,
    dataType: trait.dataType,
    descriptive,
    qc,
    populationTrajectory: buildPopulationTrajectory(canonical),
    ...buildEntityTrajectoriesField(canonicalGroups),
    derivedFeatures: buildDerivedFeatures(canonicalGroups),
    rankStability: buildRankStability(canonical),
    withinEntityStability: buildWithinEntityStability(
      rawGroups,
      canonicalGroups,
    ),
    repeatability: estimateTraitRepeatability(
      rows.map((r) => ({
        phenotypeId: r.phenotypeId,
        evaluationDate: r.evaluationDate,
        value: r.numericValue,
      })),
    ),
    heritability: {
      status: "not_estimable",
      reasons: [...HERITABILITY_NOT_ESTIMABLE_REASONS],
    },
    associations: [],
    warnings: buildWarnings(
      rows,
      descriptive.nEvaluationEventsWithoutTrait,
      nEvaluationEvents,
    ),
  };
}

function buildEntityTrajectoriesField(
  canonicalGroups: Map<string, CanonicalPoint[]>,
) {
  const { trajectories, truncated } = buildEntityTrajectories(canonicalGroups);
  return {
    entityTrajectories: trajectories,
    entityTrajectoriesTruncated: truncated,
  };
}
