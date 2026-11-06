// Pure function only - no "server-only" guard, directly unit-testable,
// same convention as src/lib/met/design-summary.ts. Task review §24/§48:
// a transparent selection differential, computed independently of any R
// model, for every selected trait - never automatically "genetic gain"
// (task review §25).
import type {
  BreedingCandidateTraitMatrix,
  BreedingTraitDirection,
} from "./types";
import { getCell } from "./types";

export type SelectionDifferentialRow = {
  traitId: string;
  traitCode: string;
  direction: BreedingTraitDirection;
  targetValue: number | null;
  /** Mean over every candidate with a non-null value for this trait -
   * never requires complete cases across OTHER traits (task review §14:
   * a method's own complete-case policy is separate from this). */
  populationMean: number;
  populationN: number;
  /** Mean over the selected candidates with a non-null value. */
  selectedMean: number;
  selectedN: number;
  absoluteDifferential: number;
  /** null when populationMean is 0 - a percentage against a zero
   * denominator is meaningless, never shown as a misleading number
   * (task review §48). */
  percentageDifferential: number | null;
  /** Whether the differential moves in the direction the breeder
   * actually wants (task review §24): for higher_is_better, > 0; for
   * lower_is_better, < 0; for target_value, the selected mean is at
   * least as close to targetValue as the population mean. Null when
   * either mean has zero supporting candidates. */
  directionAchieved: boolean | null;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Computes one selection-differential row per trait in `matrix.traits`.
 * `selectedCandidateIds` is the post-ranking selected set (e.g. the top
 * `selection_proportion`% by some method's own score) - this function
 * never decides who is selected, only summarizes the trait-by-trait
 * consequence of whatever set it is given. */
export function computeSelectionDifferentials(
  matrix: BreedingCandidateTraitMatrix,
  selectedCandidateIds: readonly string[],
): SelectionDifferentialRow[] {
  const selectedSet = new Set(selectedCandidateIds);
  return matrix.traits.map((trait) => {
    const populationValues: number[] = [];
    const selectedValues: number[] = [];
    for (const candidate of matrix.candidates) {
      const value = getCell(matrix, candidate.candidateId, trait.traitId);
      if (value === null) continue;
      populationValues.push(value);
      if (selectedSet.has(candidate.candidateId)) selectedValues.push(value);
    }
    const populationMean = mean(populationValues) ?? 0;
    const selectedMean = mean(selectedValues) ?? 0;
    const absoluteDifferential =
      selectedValues.length > 0 ? selectedMean - populationMean : 0;
    const percentageDifferential =
      populationValues.length > 0 &&
      populationMean !== 0 &&
      selectedValues.length > 0
        ? (absoluteDifferential / Math.abs(populationMean)) * 100
        : null;

    let directionAchieved: boolean | null = null;
    if (populationValues.length > 0 && selectedValues.length > 0) {
      if (trait.direction === "higher_is_better") {
        directionAchieved = absoluteDifferential > 0;
      } else if (trait.direction === "lower_is_better") {
        directionAchieved = absoluteDifferential < 0;
      } else if (
        trait.direction === "target_value" &&
        trait.targetValue !== null
      ) {
        directionAchieved =
          Math.abs(selectedMean - trait.targetValue) <=
          Math.abs(populationMean - trait.targetValue);
      }
    }

    return {
      traitId: trait.traitId,
      traitCode: trait.traitCode,
      direction: trait.direction,
      targetValue: trait.targetValue,
      populationMean,
      populationN: populationValues.length,
      selectedMean,
      selectedN: selectedValues.length,
      absoluteDifferential,
      percentageDifferential,
      directionAchieved,
    };
  });
}
