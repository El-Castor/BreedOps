// Pure function only (no DB/network access) - no "server-only" guard, same
// convention as design-summary.ts, so it stays directly unit-testable.
//
// Runs BEFORE any G×E model is ever attempted (B13-B14): a cheap,
// deterministic check of whether the fetched MET dataset actually supports
// an Entry×Environment analysis at all, with specific reasons rather than
// a fabricated result. Mirrors the eligibility gate already enforced
// server-side inside analytics-r/scripts/met_models.R (MIN_ENTRIES,
// MIN_ENVIRONMENTS, the shared-entries check) so the UI can show the exact
// same verdict - and avoid spawning the R engine at all - without that
// duplication ever becoming the single source of truth: met_models.R
// re-checks independently and is what actually decides NOT_ESTIMABLE for
// any real analysis request, this module is a fast pre-flight mirror of
// it, not a replacement for it.
import {
  summarizeMetDesign,
  computeCellReplicationDiagnostics,
  detectMetLongitudinalAmbiguity,
  type MetDesignSummary,
  type MetCellReplicationDiagnostics,
} from "./design-summary";
import type { MetObservationRecord } from "./types";
import type { MetModelType } from "./r-model-types";

/** MUST match MIN_ENTRIES in analytics-r/scripts/met_models.R. */
export const MIN_ENTRIES = 2;
/** MUST match MIN_ENVIRONMENTS in analytics-r/scripts/met_models.R. */
export const MIN_ENVIRONMENTS = 2;
/** MUST match the shared-entries threshold in
 * analytics-r/scripts/met_models.R (there, `entries_in_multiple_envs <
 * MIN_ENTRIES`); kept as its own named constant here because it is a
 * logically distinct requirement (replicated material, not raw entry
 * count) even though its numeric value happens to be the same today. */
export const MIN_SHARED_ENTRIES = MIN_ENTRIES;

export type MetBalanceSummary = {
  /** Every populated entry x environment cell has the same number of
   * observations. A design can be eligible without being balanced -
   * sommer/metan both handle unbalanced data (B15/B19) - this is reported
   * as a warning, never a blocker. */
  isBalanced: boolean;
  minCellObservations: number;
  maxCellObservations: number;
  /** Entry x environment combinations with zero observations, out of
   * entryCount x environmentCount. A trial design can legitimately have
   * missing cells (not every entry is sown everywhere); this is never
   * silently imputed (B40) - only reported. */
  missingCells: number;
  totalCells: number;
};

export type MetEligibilityReport = {
  eligible: boolean;
  /** Blocking reasons - non-empty if and only if eligible is false. Each
   * reason is precise enough to show directly in the UI, in French,
   * matching the wording met_models.R itself uses for the same checks. */
  reasons: string[];
  /** Non-blocking cautions about the design (imbalance, missing cells,
   * single-replicate cells, ...): surfaced to the user, never acted on
   * silently and never upgraded into a blocking reason on their own. */
  warnings: string[];
  design: MetDesignSummary;
  balance: MetBalanceSummary;
};

function computeBalance(rows: MetObservationRecord[]): MetBalanceSummary {
  const cellCounts = new Map<string, number>();
  const entries = new Set<string>();
  const environments = new Set<string>();
  for (const row of rows) {
    entries.add(row.entryId);
    environments.add(row.environmentId);
    const key = `${row.entryId}||${row.environmentId}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const totalCells = entries.size * environments.size;
  const populatedCounts = [...cellCounts.values()];
  const minCellObservations = populatedCounts.length
    ? Math.min(...populatedCounts)
    : 0;
  const maxCellObservations = populatedCounts.length
    ? Math.max(...populatedCounts)
    : 0;
  const missingCells = totalCells - cellCounts.size;
  return {
    isBalanced:
      missingCells === 0 && minCellObservations === maxCellObservations,
    minCellObservations,
    maxCellObservations,
    missingCells,
    totalCells,
  };
}

/** The one eligibility verdict every V2-05 UI screen and R-engine caller
 * should check before offering/running an analysis. Never returns
 * `eligible: true` by any path other than passing every one of the three
 * hard checks below - there is no "mostly eligible" or best-effort mode. */
export function evaluateMetEligibility(
  rows: MetObservationRecord[],
): MetEligibilityReport {
  const design = summarizeMetDesign(rows);
  const balance = computeBalance(rows);
  const reasons: string[] = [];

  if (design.environmentCount < MIN_ENVIRONMENTS) {
    reasons.push(
      `Au moins ${MIN_ENVIRONMENTS} environnements distincts sont nécessaires (trouvé : ${design.environmentCount}).`,
    );
  }
  if (design.entryCount < MIN_ENTRIES) {
    reasons.push(
      `Au moins ${MIN_ENTRIES} entrées distinctes sont nécessaires (trouvé : ${design.entryCount}).`,
    );
  }
  // Only check shared-entries coverage once the basic counts already pass -
  // identical gating order to met_models.R, so the same dataset never gets
  // a different reason from the two layers.
  if (reasons.length === 0 && design.sharedEntryCount < MIN_SHARED_ENTRIES) {
    reasons.push(
      "Aucune entrée commune n'est observée dans au moins deux environnements : l'effet Entrée x Environnement n'est pas identifiable.",
    );
  }

  const warnings: string[] = [];
  if (reasons.length === 0) {
    if (balance.missingCells > 0) {
      warnings.push(
        `${balance.missingCells} combinaison(s) entrée x environnement sur ${balance.totalCells} n'ont aucune observation - le jeu de données est déséquilibré.`,
      );
    }
    if (balance.minCellObservations === 1 && balance.missingCells === 0) {
      warnings.push(
        "Certaines combinaisons entrée x environnement n'ont qu'une seule observation : la précision de l'estimation de l'interaction peut être faible.",
      );
    }
  }

  return { eligible: reasons.length === 0, reasons, warnings, design, balance };
}

export type MetModelEligibilityReport = MetEligibilityReport & {
  modelType: MetModelType;
  /** Only populated for met_base_v1 - the within-cell replication
   * identifiability check (B-review blocker #2). */
  replication?: MetCellReplicationDiagnostics;
};

function entryEnvironmentCounts(
  rows: MetObservationRecord[],
): Map<string, number> {
  const entryEnvironments = new Map<string, Set<string>>();
  for (const row of rows) {
    const envs = entryEnvironments.get(row.entryId) ?? new Set<string>();
    envs.add(row.environmentId);
    entryEnvironments.set(row.entryId, envs);
  }
  const counts = new Map<string, number>();
  for (const [entryId, envs] of entryEnvironments)
    counts.set(entryId, envs.size);
  return counts;
}

/** Layers model-specific requirements on top of the generic gate above -
 * mirroring, for UI diagnostics, the per-model checks
 * analytics-r/scripts/met_models.R itself enforces (B-review blocker #6).
 * The R engine remains the final authority: this is a fast preflight, not
 * a replacement for it, and every reason string here is worded to match
 * met_models.R's own wording for the same check. */
export function evaluateMetModelEligibility(
  modelType: MetModelType,
  rows: MetObservationRecord[],
): MetModelEligibilityReport {
  const base = evaluateMetEligibility(rows);
  if (!base.eligible) {
    return { ...base, modelType };
  }

  const reasons = [...base.reasons];
  const warnings = [...base.warnings];
  let replication: MetCellReplicationDiagnostics | undefined;

  if (modelType === "met_base_v1") {
    // Entry×Environment variance and residual variance are not separately
    // identifiable with exactly one observation per cell - confirmed
    // empirically against lme4::lmer()'s own hard check ("number of
    // levels of each grouping factor must be < number of observations"),
    // not an arbitrary threshold. See analytics-r/scripts/met_models.R's
    // identical check for the full rationale.
    replication = computeCellReplicationDiagnostics(rows);
    if (replication.replicatedCells === 0) {
      reasons.push(
        `La variance Entrée x Environnement et la variance résiduelle ne sont pas identifiables séparément : chacune des ${replication.populatedCells} cellules Entrée x Environnement ne compte qu'une seule observation (${replication.totalObservations} observations au total). Au moins une cellule doit comporter une répétition.`,
      );
    } else if (replication.replicatedCells < replication.populatedCells) {
      warnings.push(
        `Seules ${replication.replicatedCells} cellule(s) sur ${replication.populatedCells} comportent une répétition : la séparation entre la variance Entrée x Environnement et la variance résiduelle repose sur un nombre réduit de cellules.`,
      );
    }
  }

  if (modelType === "met_waasb_v1" || modelType === "met_ammi_v1") {
    // Both metan::waasb() and metan::performs_ammi() require STRICTLY more
    // than 2 entries AND more than 2 environments - confirmed empirically
    // (see analytics-r/scripts/met_models.R's identical checks).
    if (base.design.entryCount <= 2 || base.design.environmentCount <= 2) {
      const label = modelType === "met_waasb_v1" ? "WAASB" : "AMMI";
      reasons.push(
        `Le modèle ${label} nécessite plus de 2 entrées et plus de 2 environnements (contrairement au modèle de base, qui n'en nécessite que 2).`,
      );
    }
  }

  if (modelType === "met_ammi_v1" || modelType === "met_gge_v1") {
    // Neither metan::performs_ammi() nor metan::gge() excludes a missing
    // Entry×Environment cell - both impute it (EM-SVD) before fitting,
    // confirmed by reading metan's own source. Never silent (B40): this
    // warning is shown even before the R engine runs.
    if (base.balance.missingCells > 0) {
      warnings.push(
        `${base.balance.missingCells} cellule(s) Entrée x Environnement manquante(s) seront comblées par le moteur statistique (méthode EM-SVD) avant ce calcul, plutôt qu'exclues.`,
      );
    }
  }

  if (modelType === "met_finlay_wilkinson_v1") {
    // Every entry included in a Finlay-Wilkinson regression must itself be
    // observed in at least 2 environments - the regression is fit PER
    // ENTRY against the environmental index, and the generic shared-
    // entries gate above only guarantees 2+ entries overall qualify, not
    // every individual entry. See analytics-r/scripts/met_models.R's
    // identical check for the full rationale (an entry with only 1
    // environment was found, empirically, to still produce a confident-
    // looking but degenerate fit rather than failing).
    const counts = entryEnvironmentCounts(rows);
    const insufficientEntries = [...counts.entries()]
      .filter(([, count]) => count < 2)
      .map(([entryId]) => entryId);
    if (insufficientEntries.length > 0) {
      reasons.push(
        `Le modèle de régression conjointe (Finlay-Wilkinson) nécessite que chaque entrée soit observée dans au moins 2 environnements. Entrée(s) insuffisante(s) : ${insufficientEntries.join(", ")}.`,
      );
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    warnings,
    design: base.design,
    balance: base.balance,
    modelType,
    replication,
  };
}

export type MetOccasionEligibility = {
  eligible: boolean;
  reasons: string[];
  /** Every distinct non-null evaluation_date found in the UNFILTERED
   * dataset - offered to the user as candidate occasions regardless of
   * `eligible`, so a UI can let the user switch occasions even when the
   * current one was already fine. */
  availableDates: string[];
};

/** B-review blocker #3: the generic gate upstream (evaluateMetEligibility)
 * and the model-specific layer (evaluateMetModelEligibility) both assume
 * their `rows` input already represents ONE coherent measurement
 * occasion. This function is what establishes that - it MUST be called
 * against an unfiltered fetch (every evaluation_date for this trial/
 * trait, not a single occasion) before any scoped fetch is made, because
 * detecting the ambiguity requires seeing every date at once.
 *
 * Blocks only when the SAME phenotype (the same Entry×Environment
 * physical unit) has 2+ distinct dated evaluations for this trait AND no
 * occasion has been explicitly selected - never when different
 * phenotypes simply happen to have been measured on different calendar
 * dates (normal: each environment is its own campaign). Never silently
 * averages dates or treats them as independent replicates; the caller
 * must re-fetch with that exact evaluationDate (migration 000031's
 * target_evaluation_date, server-side filtered) before building the
 * dataset actually used for modelling. */
export function evaluateMetOccasionEligibility(
  discoveryRows: MetObservationRecord[],
  selectedEvaluationDate: string | null,
): MetOccasionEligibility {
  const { ambiguous, availableDates } =
    detectMetLongitudinalAmbiguity(discoveryRows);
  if (ambiguous && !selectedEvaluationDate) {
    return {
      eligible: false,
      reasons: [
        "Des mesures longitudinales répétées ont été détectées pour la même unité biologique (le même phénotype porte plusieurs dates d'évaluation pour ce trait). Sélectionnez une occasion de mesure (date) avant de lancer une analyse multi-environnement : ces mesures ne sont jamais regroupées silencieusement comme s'il s'agissait de répétitions indépendantes.",
      ],
      availableDates,
    };
  }
  return { eligible: true, reasons: [], availableDates };
}
