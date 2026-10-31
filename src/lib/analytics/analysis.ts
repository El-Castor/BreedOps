// Orchestrates the single-trait "Trait Intelligence" bundle (task §30) from
// an already-fetched ObservationRecord[] (task §7's canonical dataset).
// Nothing here queries the database - see dataset.ts for that - and nothing
// here ever writes back to scientific source data (task §8).

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
} from "./stats";
import { estimateRepeatability } from "./icc";
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

function buildPopulationTrajectory(
  rows: ObservationRecord[],
): PopulationTrajectoryPoint[] {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.evaluationDate) continue;
    const list = byDate.get(row.evaluationDate) ?? [];
    list.push(row.numericValue);
    byDate.set(row.evaluationDate, list);
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

function buildEntityTrajectories(groups: Map<string, ObservationRecord[]>): {
  trajectories: EntityTrajectory[];
  truncated: boolean;
} {
  const phenotypeIds = [...groups.keys()].sort((a, b) => {
    const codeA = groups.get(a)![0].phenotypeCode;
    const codeB = groups.get(b)![0].phenotypeCode;
    return codeA < codeB ? -1 : codeA > codeB ? 1 : 0;
  });
  const truncated = phenotypeIds.length > MAX_INDIVIDUAL_TRAJECTORIES;
  const selected = phenotypeIds.slice(0, MAX_INDIVIDUAL_TRAJECTORIES);
  const trajectories = selected.map((phenotypeId) => {
    const rows = groups.get(phenotypeId)!;
    const dated = rows.filter((r) => r.evaluationDate);
    dated.sort((a, b) => (a.evaluationDate! < b.evaluationDate! ? -1 : 1));
    return {
      phenotypeId,
      phenotypeCode: rows[0].phenotypeCode,
      points: dated.map((r) => ({
        date: r.evaluationDate!,
        value: r.numericValue,
      })),
    };
  });
  return { trajectories, truncated };
}

function buildDerivedFeatures(
  groups: Map<string, ObservationRecord[]>,
): DerivedLongitudinalFeature[] {
  const features: DerivedLongitudinalFeature[] = [];
  for (const [phenotypeId, rows] of groups) {
    const dated = rows.filter((r) => r.evaluationDate);
    if (dated.length === 0) continue;
    dated.sort((a, b) => (a.evaluationDate! < b.evaluationDate! ? -1 : 1));
    const first = dated[0];
    const last = dated[dated.length - 1];
    const points = dated.map((r) => ({
      t: daysSinceEpoch(r.evaluationDate!),
      v: r.numericValue,
    }));
    const change = relativeChange(first.numericValue, last.numericValue);
    features.push({
      phenotypeId,
      phenotypeCode: rows[0].phenotypeCode,
      firstValue: first.numericValue,
      lastValue: last.numericValue,
      firstDate: first.evaluationDate!,
      lastDate: last.evaluationDate!,
      absoluteChange: change.absolute,
      relativeChange: change.relative,
      auc: trapezoidalAuc(points),
      slope: linearSlope(points),
      nMeasurements: dated.length,
      spanDays: points[points.length - 1].t - points[0].t,
    });
  }
  return features;
}

function buildRankStability(
  groups: Map<string, ObservationRecord[]>,
): RankStabilityPair[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const [phenotypeId, rows] of groups) {
    for (const row of rows) {
      if (!row.evaluationDate) continue;
      const map = byDate.get(row.evaluationDate) ?? new Map<string, number>();
      map.set(phenotypeId, row.numericValue);
      byDate.set(row.evaluationDate, map);
    }
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

function buildWithinEntityStability(
  groups: Map<string, ObservationRecord[]>,
): WithinEntityStability[] {
  const result: WithinEntityStability[] = [];
  for (const [phenotypeId, rows] of groups) {
    if (rows.length < MIN_WITHIN_ENTITY_OBSERVATIONS) continue;
    const values = rows.map((r) => r.numericValue);
    const dated = rows
      .filter((r) => r.evaluationDate)
      .map((r) => ({
        t: daysSinceEpoch(r.evaluationDate!),
        v: r.numericValue,
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
  nMissing: number,
  nTotal: number,
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  const missingRate = nTotal > 0 ? nMissing / nTotal : 0;
  if (missingRate > 0.3) {
    warnings.push({
      level: "caution",
      message: `Taux de données manquantes élevé (${(missingRate * 100).toFixed(1)} %) : interpréter les résultats avec prudence.`,
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
  nMissing: number,
  truncated: boolean,
): TraitIntelligenceBundle {
  const values = rows.map((r) => r.numericValue);
  const nTotal = rows.length + nMissing;
  const descriptive = descriptiveStats(values, nTotal);
  const bounds = outlierBounds(descriptive.q1, descriptive.q3);
  const qc = buildQc(rows, bounds);
  const groups = groupByPhenotype(rows);

  return {
    traitId: trait.traitId,
    traitCode: trait.code,
    traitName: trait.name,
    unit: trait.unit,
    direction: trait.direction,
    targetValue: trait.targetValue,
    dataType: trait.dataType,
    nTotalRows: rows.length,
    truncated,
    descriptive,
    qc,
    populationTrajectory: buildPopulationTrajectory(rows),
    ...buildEntityTrajectoriesField(groups),
    derivedFeatures: buildDerivedFeatures(groups),
    rankStability: buildRankStability(groups),
    withinEntityStability: buildWithinEntityStability(groups),
    repeatability: estimateRepeatability(
      [...groups.values()].map((g) => g.map((r) => r.numericValue)),
    ),
    heritability: {
      status: "not_estimable",
      reasons: [...HERITABILITY_NOT_ESTIMABLE_REASONS],
    },
    associations: [],
    warnings: buildWarnings(rows, nMissing, nTotal),
  };
}

function buildEntityTrajectoriesField(
  groups: Map<string, ObservationRecord[]>,
) {
  const { trajectories, truncated } = buildEntityTrajectories(groups);
  return {
    entityTrajectories: trajectories,
    entityTrajectoriesTruncated: truncated,
  };
}
