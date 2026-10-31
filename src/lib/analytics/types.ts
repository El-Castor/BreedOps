import type { CvResult, EligibilityResult } from "./stats";
import type { IccResult } from "./icc";

/** One canonical observation record (task §7). Every V2-04 chart/table is
 * built from a list of these - never from its own independent query. */
export type ObservationRecord = {
  traitId: string;
  traitCode: string;
  traitName: string;
  unit: string | null;
  direction: string;
  targetValue: number | null;

  phenotypeId: string;
  phenotypeCode: string;

  familyId: string | null;
  seedLotId: string | null;

  block: string | null;
  replicate: number | null;
  location: string | null;

  evaluationId: string;
  evaluationDate: string | null;
  evaluatorId: string | null;

  traitValueId: string;
  numericValue: number;
};

export type AnalyticsFilters = {
  programId: string;
  traitId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  familyIds?: string[] | null;
  seedLotIds?: string[] | null;
  blocks?: string[] | null;
  replicates?: number[] | null;
  locations?: string[] | null;
  includeArchived: boolean;
};

export type OutlierRow = {
  phenotypeId: string;
  phenotypeCode: string;
  value: number;
  evaluationId: string;
  evaluationDate: string | null;
  block: string | null;
  replicate: number | null;
  familyId: string | null;
  seedLotId: string | null;
};

export type QualityControl = {
  outliers: OutlierRow[];
  bounds: { lower: number; upper: number };
  histogram: { binStart: number; binEnd: number; count: number }[];
};

export type TrajectoryPoint = { date: string; value: number };
export type EntityTrajectory = {
  phenotypeId: string;
  phenotypeCode: string;
  points: TrajectoryPoint[];
};

export type PopulationTrajectoryPoint = {
  date: string;
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
};

export type DerivedLongitudinalFeature = {
  phenotypeId: string;
  phenotypeCode: string;
  firstValue: number;
  lastValue: number;
  firstDate: string;
  lastDate: string;
  absoluteChange: number;
  relativeChange: number | null;
  auc: EligibilityResult<{ auc: number }>;
  slope: EligibilityResult<{
    slope: number;
    intercept: number;
    r2: number;
    n: number;
  }>;
  nMeasurements: number;
  spanDays: number;
};

export type RankStabilityPair = {
  dateA: string;
  dateB: string;
  pairedN: number;
  rho: number | null;
  insufficientN?: boolean;
};

export type WithinEntityStability = {
  phenotypeId: string;
  phenotypeCode: string;
  n: number;
  sd: number;
  cv: CvResult;
  range: number;
  slope: EligibilityResult<{
    slope: number;
    intercept: number;
    r2: number;
    n: number;
  }>;
};

export type TraitAssociation = {
  traitId: string;
  traitCode: string;
  traitName: string;
  pairedN: number;
  pearsonR: number | null;
  pearsonP: number | null;
  pearsonQ: number | null;
  spearmanRho: number | null;
};

export type EarlyProxyEvidence = {
  sourceTraitId: string;
  sourceTraitName: string;
  sourceWindow: { from: string; to: string };
  targetTraitId: string;
  targetTraitName: string;
  targetWindow: { from: string; to: string };
  pairedN: number;
  medianDaysEarlier: number | null;
  pearsonR: number | null;
  spearmanRho: number | null;
  repeatability: EligibilityResult<IccResult> | null;
  missingPct: number;
};

export type TraitIntelligenceBundle = {
  traitId: string;
  traitCode: string;
  traitName: string;
  unit: string | null;
  direction: string;
  targetValue: number | null;
  dataType: "numeric" | "integer" | "ordinal";

  nTotalRows: number;
  truncated: boolean;

  descriptive: import("./stats").DescriptiveStats;
  qc: QualityControl;
  populationTrajectory: PopulationTrajectoryPoint[];
  entityTrajectories: EntityTrajectory[];
  entityTrajectoriesTruncated: boolean;
  derivedFeatures: DerivedLongitudinalFeature[];
  rankStability: RankStabilityPair[];
  withinEntityStability: WithinEntityStability[];
  repeatability: EligibilityResult<IccResult>;
  heritability: { status: "not_estimable"; reasons: string[] };
  associations: TraitAssociation[];
  warnings: AnalysisWarning[];
};

export type AnalysisWarning = {
  level: "info" | "caution" | "not_estimable";
  message: string;
};

export type CategoricalSummary = {
  traitId: string;
  traitCode: string;
  traitName: string;
  dataType: "categorical" | "boolean";
  nTotal: number;
  nObserved: number;
  nMissing: number;
  categories: { label: string; count: number; proportion: number }[];
};
