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

/** `rawCount` is how many raw observations were averaged into this one
 * canonical per-occasion point (task review finding #4): 1 when there was
 * no duplicate, >1 when `phenotypeId`+`date` carried more than one
 * observation and they were combined by arithmetic mean - never silently
 * discarded, and exposed here for transparency. */
export type TrajectoryPoint = { date: string; value: number; rawCount: number };
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
  /** Distinct measurement occasions (dates) used - the canonical series
   * size, after same-phenotype/same-date duplicates are aggregated by
   * mean (task review finding #4). */
  nMeasurements: number;
  /** Raw observation rows that fed those `nMeasurements` occasions, before
   * aggregation. Equal to nMeasurements unless at least one date carried
   * more than one observation. */
  rawObservationCount: number;
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
  /** Repeatability of the SOURCE trait within its own window, subject to
   * the exact same longitudinal eligibility rule as the main Trait
   * Intelligence panel (task review finding #3): a source window spanning
   * more than one evaluation date is NOT_ESTIMABLE, never a one-way ICC
   * silently confounding growth with measurement noise. */
  repeatability: EligibilityResult<IccResult> | null;
  /** Entities present in the source window that were NOT found again in
   * the target window, as a fraction of all source-window entities - a
   * pairing/coverage-loss figure, never biological missingness (task
   * review finding #2): an entity can be absent from the target window
   * for many reasons (not yet measured, program attrition, the window
   * itself too narrow), none of which this schema can distinguish. */
  unpairedSourceEntitiesRatio: number;
};

export type TraitIntelligenceBundle = {
  traitId: string;
  traitCode: string;
  traitName: string;
  unit: string | null;
  direction: string;
  targetValue: number | null;
  dataType: "numeric" | "integer" | "ordinal";

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

export type CategoricalObservationRecord = {
  traitValueId: string;
  textValue: string | null;
  booleanValue: boolean | null;
  evaluationId: string;
  evaluationDate: string | null;
  phenotypeId: string;
  phenotypeCode: string;
};

/** Frequency-only summary for a categorical/boolean trait (task §5): never
 * mean/SD/ICC/Pearson/longitudinal models, which are only valid for
 * numeric/integer/ordinal data. Uses the same "coverage" terminology as
 * DescriptiveStats - see its field comments - rather than inventing a
 * "missing" concept this schema cannot actually identify. */
export type CategoricalSummary = {
  traitId: string;
  traitCode: string;
  traitName: string;
  dataType: "categorical" | "boolean";
  nEvaluationEvents: number;
  nObserved: number;
  nEvaluationEventsWithoutTrait: number;
  coverageRatio: number | null;
  categories: { label: string; count: number; proportion: number }[];
};

export type EarlyProxyResult =
  | { status: "ok"; evidence: EarlyProxyEvidence }
  | { status: "dataset_too_large" };

/** DATASET_TOO_LARGE is an explicit outcome, not a silent truncation (task
 * review finding #1): the filtered dataset (or its evaluation-cohort
 * denominator) exceeds MAX_OBSERVATION_ROWS, so no statistic is computed
 * on a prefix of it - the caller must narrow its filters instead. */
export type TraitIntelligenceResult =
  | { status: "ok"; bundle: TraitIntelligenceBundle }
  | { status: "dataset_too_large"; atLeast: number }
  | { status: "trait_not_found" };
