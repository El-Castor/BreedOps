// Pure types only - no "server-only" guard, so modules that only need the
// shapes (not DB/R access) stay directly unit-testable. Sibling of
// src/lib/met/types.ts for V2-06.

/** The source classes V2-06 actually implements a resolver for (task
 * review §8: "Supported source classes should be named precisely" - the
 * DB's own CHECK constraint, migration 000033, additionally allows
 * 'ADJUSTED_ENTRY_PREDICTION' for forward-compatibility, but no resolver
 * exists for it yet - a scenario trait using it is rejected with an
 * explicit "not yet supported" reason, never silently treated as one of
 * these four). */
export const BREEDING_SOURCE_TYPES = [
  "RAW_PHENOTYPIC",
  "PHENOTYPIC_MEAN",
  "MET_ENTRY_PREDICTION",
  "WAASBY_STABILITY_PERFORMANCE",
] as const;
export type BreedingSourceType = (typeof BREEDING_SOURCE_TYPES)[number];

/** Every source_type the database schema allows, including the one this
 * application layer does not yet resolve - kept separate from
 * BreedingSourceType so "not yet supported" is a type-level fact, not
 * just a runtime check. */
export const ALL_BREEDING_SOURCE_TYPES_INCLUDING_UNSUPPORTED = [
  ...BREEDING_SOURCE_TYPES,
  "ADJUSTED_ENTRY_PREDICTION",
] as const;

export type BreedingTraitDirection =
  | "higher_is_better"
  | "lower_is_better"
  | "target_value";

/** The strongest evidence level actually supported by a run's chosen
 * sources - never upgraded automatically (task review §10). Ordered
 * weakest to strongest; evidenceLevelRank() below gives the ordering. */
export const BREEDING_EVIDENCE_LEVELS = [
  "PHENOTYPIC",
  "ADJUSTED_ENTRY",
  "GENOTYPIC",
  "ADDITIVE_GENETIC",
] as const;
export type BreedingEvidenceLevel = (typeof BREEDING_EVIDENCE_LEVELS)[number];

export function evidenceLevelForSource(
  sourceType: BreedingSourceType,
): BreedingEvidenceLevel {
  switch (sourceType) {
    case "RAW_PHENOTYPIC":
    case "PHENOTYPIC_MEAN":
      return "PHENOTYPIC";
    case "MET_ENTRY_PREDICTION":
    case "WAASBY_STABILITY_PERFORMANCE":
      return "ADJUSTED_ENTRY";
  }
}

/** The weakest of several evidence levels - a run's overall evidence
 * level is never stronger than its weakest-evidenced selected trait
 * (task review §10: "Use the strongest level actually supported", which
 * for a multi-trait run means bounded by the least-supported trait). */
export function weakestEvidenceLevel(
  levels: BreedingEvidenceLevel[],
): BreedingEvidenceLevel {
  let weakestIndex = BREEDING_EVIDENCE_LEVELS.length - 1;
  for (const level of levels) {
    const index = BREEDING_EVIDENCE_LEVELS.indexOf(level);
    if (index < weakestIndex) weakestIndex = index;
  }
  return BREEDING_EVIDENCE_LEVELS[weakestIndex];
}

export type BreedingCandidateRecord = {
  candidateId: string;
  candidateCode: string;
  candidateLabel: string;
  candidateScientificRole:
    | "genotype"
    | "family"
    | "population"
    | "seed_lot"
    | "other";
  /** From the EXISTING operational scoring workflow
   * (phenotype_evaluations.is_eliminated on this candidate's most recent
   * evaluation) - a diagnostic flag, never an automatic exclusion; see
   * BreedingCandidateEligibility. */
  operationallyEliminated: boolean;
};

export type BreedingScenarioTraitSpec = {
  traitId: string;
  traitCode: string;
  traitName: string;
  unit: string | null;
  direction: BreedingTraitDirection;
  targetValue: number | null;
  weight: number | null;
  economicWeight: number | null;
  sourceType: BreedingSourceType;
  sourceRunId: string | null;
  evaluationDate: string | null;
};

/** One candidate x trait cell - `value: null` means missing, never
 * imputed (task review §14). */
export type BreedingMatrixCell = {
  candidateId: string;
  traitId: string;
  value: number | null;
};

export type BreedingCoverageDiagnostics = {
  candidateCount: number;
  traitCount: number;
  completeCandidateCount: number;
  missingCells: number;
  /** completeCandidateCount / candidateCount, or 0 if candidateCount is 0. */
  coverage: number;
};

export type BreedingCandidateTraitMatrix = {
  candidates: BreedingCandidateRecord[];
  traits: BreedingScenarioTraitSpec[];
  cells: BreedingMatrixCell[];
  /** The weakest evidence level across every selected trait - see
   * weakestEvidenceLevel(). */
  evidenceLevel: BreedingEvidenceLevel;
  coverage: BreedingCoverageDiagnostics;
};

export function getCell(
  matrix: BreedingCandidateTraitMatrix,
  candidateId: string,
  traitId: string,
): number | null {
  const cell = matrix.cells.find(
    (c) => c.candidateId === candidateId && c.traitId === traitId,
  );
  return cell ? cell.value : null;
}

/** Candidates with a non-null value for every selected trait - the
 * complete-case subset a method requiring complete cases must use
 * explicitly (task review §14), never a silent change to the candidate
 * population. */
export function completeCaseCandidateIds(
  matrix: BreedingCandidateTraitMatrix,
): string[] {
  const traitIds = matrix.traits.map((t) => t.traitId);
  return matrix.candidates
    .filter((c) =>
      traitIds.every(
        (traitId) => getCell(matrix, c.candidateId, traitId) !== null,
      ),
    )
    .map((c) => c.candidateId);
}
