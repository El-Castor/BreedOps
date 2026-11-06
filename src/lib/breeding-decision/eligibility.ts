// Pure function only (no DB/network access) - no "server-only" guard, same
// convention as src/lib/met/eligibility.ts, so it stays directly
// unit-testable. Mirrors, for fast UI diagnostics, the per-method
// eligibility gates analytics-r/scripts/selection_models.R itself
// enforces - the R engine remains the final authority; this is a
// preflight, never a replacement for it.
import type {
  BreedingCandidateTraitMatrix,
  BreedingScenarioTraitSpec,
} from "./types";
import { completeCaseCandidateIds } from "./types";
import type { SelectionModelType } from "./r-model-types";

export type SelectionMethodEligibility = {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  /** The candidates actually usable by the method once complete-case
   * filtering is applied (task review §14 - never a silent change to
   * the candidate population; this is always disclosed). */
  completeCaseCandidateIds: string[];
  excludedForMissingData: string[];
};

function completeCaseEligibility(matrix: BreedingCandidateTraitMatrix): {
  completeIds: string[];
  excludedIds: string[];
} {
  const completeIds = completeCaseCandidateIds(matrix);
  const completeSet = new Set(completeIds);
  const excludedIds = matrix.candidates
    .map((c) => c.candidateId)
    .filter((id) => !completeSet.has(id));
  return { completeIds, excludedIds };
}

/** MGIDI (task review §44, validated empirically against metan::mgidi()
 * - see analytics-r/tests/test_selection_mgidi.R):
 *   - at least 2 traits: metan::mgidi() itself refuses a single
 *     variable.
 *   - strictly more complete-case candidates than traits: below this,
 *     metan::mgidi() silently returns a perfectly-saturated (+-1)
 *     correlation matrix between every pair of traits - statistically
 *     meaningless, but not refused by the package itself. BreedOps adds
 *     the guard metan omits. */
function evaluateMgidiEligibility(
  matrix: BreedingCandidateTraitMatrix,
): SelectionMethodEligibility {
  const { completeIds, excludedIds } = completeCaseEligibility(matrix);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const nTraits = matrix.traits.length;

  if (nTraits < 2) {
    reasons.push(
      "Le MGIDI nécessite au moins 2 traits (un indice multi-traits ne peut pas être calculé avec une seule variable).",
    );
  }
  if (completeIds.length <= nTraits) {
    reasons.push(
      `Le MGIDI nécessite strictement plus de candidats complets que de traits sélectionnés (${completeIds.length} candidat(s) complet(s) pour ${nTraits} trait(s)) : en dessous de ce seuil, la matrice de corrélation entre traits est parfaitement saturée et l'analyse factorielle n'a aucun sens statistique.`,
    );
  }
  if (excludedIds.length > 0 && reasons.length === 0) {
    warnings.push(
      `${excludedIds.length} candidat(s) exclu(s) par filtrage des cas complets (valeur manquante pour au moins un trait sélectionné).`,
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    warnings,
    completeCaseCandidateIds: completeIds,
    excludedForMissingData: excludedIds,
  };
}

/** MTSI's data-independent eligibility (task review §18/§44, validated
 * empirically - see analytics-r/tests/test_selection_mtsi.R):
 *   - at least 2 traits: metan::mtsi() itself refuses a single variable,
 *     identical wording to mgidi's own guard.
 *   - no target_value traits: metan::waasb()'s own direction argument
 *     only knows higher/lower, with no distance-to-target concept.
 *
 * This is only the PART of MTSI's eligibility that depends solely on
 * the scenario's trait configuration, checkable the moment traits are
 * chosen, before any dataset is ever fetched. The remaining, heavier
 * checks - strictly more than 2 entries AND more than 2 environments in
 * the underlying raw multi-environment design, and every WAASBY trait's
 * source run sharing the same harmonized performance_weight - need
 * server-side data (the raw multi-environment dataset, and each
 * trait's own V2-05 source run) that a pure function cannot see; those
 * are layered on top in src/lib/breeding-decision/dataset.ts, at
 * candidate-matrix-build time, never re-litigated here. */
export function evaluateMtsiTraitEligibility(
  traits: readonly BreedingScenarioTraitSpec[],
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (traits.length < 2) {
    reasons.push(
      "Le MTSI nécessite au moins 2 traits (un indice multi-traits ne peut pas être calculé avec une seule variable).",
    );
  }
  const targetTraits = traits.filter((t) => t.direction === "target_value");
  if (targetTraits.length > 0) {
    reasons.push(
      `Le MTSI ne prend pas en charge les traits à valeur cible (target_value) : ${targetTraits.map((t) => t.traitCode).join(", ")}. La pondération WAASB/WAASBY ne connaît que les directions hausse/baisse.`,
    );
  }
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateSelectionMethodEligibility(
  modelType: SelectionModelType,
  matrix: BreedingCandidateTraitMatrix,
): SelectionMethodEligibility {
  switch (modelType) {
    case "selection_mgidi_v1":
      return evaluateMgidiEligibility(matrix);
    case "selection_mtsi_v1": {
      const traitEligibility = evaluateMtsiTraitEligibility(matrix.traits);
      return {
        eligible: traitEligibility.eligible,
        reasons: traitEligibility.reasons,
        warnings: [],
        completeCaseCandidateIds: [],
        excludedForMissingData: [],
      };
    }
    default:
      return {
        eligible: false,
        reasons: [
          `${modelType} n'est pas encore pris en charge par cette version de BreedOps.`,
        ],
        warnings: [],
        completeCaseCandidateIds: [],
        excludedForMissingData: [],
      };
  }
}
