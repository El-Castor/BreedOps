// Pure function only - no "server-only" guard, directly unit-testable,
// same convention as src/lib/met/design-summary.ts. Task review §24/§48:
// a transparent selection differential, computed independently of any R
// model, for every selected trait - never automatically "genetic gain"
// (task review §25).
import type {
  BreedingCandidateRecord,
  BreedingCandidateTraitMatrix,
  BreedingScenarioTraitSpec,
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

/** Builds a candidate x trait matrix of per-candidate, per-trait MEAN
 * performance from MTSI's own raw long-format observation rows (task
 * review hardening #5) - the transparent "candidate-level mean
 * performance used by the MTSI evidence" option the task review names
 * explicitly, chosen over trying to extract a selection-differential-
 * shaped quantity from metan::mtsi()/waasb()'s own return value (which
 * exposes per-genotype index/stability scores, not a population vs.
 * selected mean of the ORIGINAL trait units a breeder can read
 * directly). Documented choice: a plain arithmetic mean of every
 * available raw observation per (candidate, trait) - independent of the
 * WAASB/MTSI R model itself, exactly the same independence MGIDI's own
 * selection differential already has from metan::mgidi(). Reusing this
 * matrix with the existing computeSelectionDifferentials() above is
 * therefore correct without any new calculation logic. Never label the
 * result genetic gain - it is a phenotypic/adjusted-entry selection
 * differential, same discipline as every other BreedOps selection
 * differential. */
export function buildMeanPerformanceMatrixFromRows(
  rows: readonly { entry_id: string; trait_id: string; value: number }[],
  traits: readonly BreedingScenarioTraitSpec[],
  candidateIds: readonly string[],
): BreedingCandidateTraitMatrix {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.entry_id}||${row.trait_id}`;
    sums.set(key, (sums.get(key) ?? 0) + row.value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const candidates: BreedingCandidateRecord[] = candidateIds.map((id) => ({
    candidateId: id,
    candidateCode: id,
    candidateLabel: id,
    candidateScientificRole: "other",
    operationallyEliminated: false,
  }));
  const cells = candidateIds.flatMap((candidateId) =>
    traits.map((trait) => {
      const key = `${candidateId}||${trait.traitId}`;
      const count = counts.get(key) ?? 0;
      const mean = count > 0 ? (sums.get(key) ?? 0) / count : null;
      return { candidateId, traitId: trait.traitId, value: mean };
    }),
  );
  const missingCells = cells.filter((c) => c.value === null).length;
  const completeCandidateCount = candidateIds.filter((id) =>
    traits.every(
      (t) =>
        cells.find((c) => c.candidateId === id && c.traitId === t.traitId)
          ?.value !== null,
    ),
  ).length;
  return {
    candidates,
    traits: [...traits],
    cells,
    evidenceLevel: "ADJUSTED_ENTRY",
    coverage: {
      candidateCount: candidateIds.length,
      traitCount: traits.length,
      completeCandidateCount,
      missingCells,
      coverage:
        candidateIds.length > 0
          ? completeCandidateCount / candidateIds.length
          : 0,
    },
  };
}
