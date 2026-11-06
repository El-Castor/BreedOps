// Pure function only - no "server-only" guard, directly unit-testable.
// Task review §25-§28/§37: BreedOps must distinguish SELECTION DECISION
// from GENETIC INFERENCE, with at least these terms never used
// interchangeably: selection differential, predicted response, genotypic
// gain, additive genetic gain, realized trend. This module is where that
// distinction is made explicit and auditable, never left implicit in UI
// copy alone.

export type GeneticValidityStatus = "AVAILABLE" | "NOT_ESTIMABLE" | "DEFERRED";

export type GeneticValidityEntry = {
  status: GeneticValidityStatus;
  /** Required whenever status is not AVAILABLE - never an unlabeled
   * blank (task review §37: "with reasons"). */
  reason: string | null;
};

export type GeneticValidityPanel = {
  candidateRanking: GeneticValidityEntry;
  selectionDifferential: GeneticValidityEntry;
  multiEnvironmentStability: GeneticValidityEntry;
  broadSenseGenotypicResponse: GeneticValidityEntry;
  geneticCorrelation: GeneticValidityEntry;
  additiveBreedingValue: GeneticValidityEntry;
  expectedAdditiveGain: GeneticValidityEntry;
};

const NO_ADDITIVE_MODEL_REASON =
  "Aucun modèle de relation additive validé (matrice de parenté généalogique ou génomique) n'existe dans BreedOps - les identifiants de lignage actuels (parent_line_id/family_id/seed_lot_id) ne fournissent pas automatiquement une matrice de relation additive quantitative.";

/** Standard broad-sense heritability on an entry-mean basis:
 *   H2 = sigma2_G / (sigma2_G + sigma2_GE/e + sigma2_e/(e*r))
 * where e = number of environments and r = average within-cell
 * replication (task review §27). Requires every candidate in the trial
 * to be explicitly declared trial_entries.scientific_role='genotype'
 * (task review §3: "Even then: genotype identity != additive breeding
 * value" - this function never claims more than broad-sense, never
 * additive/narrow-sense). */
export function computeBroadSenseHeritability(params: {
  allCandidatesAreGenotypeRole: boolean;
  entryVariance: number | null;
  entryByEnvironmentVariance: number | null;
  residualVariance: number | null;
  nEnvironments: number;
  averageReplication: number;
}):
  | { status: "ESTIMABLE"; h2: number; formula: string }
  | { status: "NOT_ESTIMABLE"; reason: string } {
  if (!params.allCandidatesAreGenotypeRole) {
    return {
      status: "NOT_ESTIMABLE",
      reason:
        "Tous les candidats de cet essai ne sont pas explicitement déclarés avec scientific_role='genotype' - l'héritabilité au sens large ne peut être interprétée que pour une identité génotypique explicite.",
    };
  }
  if (params.entryVariance === null || params.residualVariance === null) {
    return {
      status: "NOT_ESTIMABLE",
      reason:
        "Les composantes de variance Entrée et résiduelle du modèle met_base_v1 source ne sont pas toutes deux estimables pour cet essai/trait.",
    };
  }
  if (params.entryVariance <= 0) {
    return {
      status: "NOT_ESTIMABLE",
      reason:
        "La variance Entrée (génotypique) estimée n'est pas strictement positive - l'héritabilité au sens large n'a pas de sens dans ce cas.",
    };
  }
  const geVariance = params.entryByEnvironmentVariance ?? 0;
  const denominator =
    params.entryVariance +
    geVariance / Math.max(params.nEnvironments, 1) +
    params.residualVariance /
      Math.max(params.nEnvironments * params.averageReplication, 1);
  if (denominator <= 0) {
    return {
      status: "NOT_ESTIMABLE",
      reason:
        "Le dénominateur de l'héritabilité au sens large n'est pas strictement positif.",
    };
  }
  const h2 = params.entryVariance / denominator;
  return {
    status: "ESTIMABLE",
    h2,
    formula: "H2 = sigma2_G / (sigma2_G + sigma2_GE/e + sigma2_e/(e*r))",
  };
}

/** Assembles the mandatory genetic-validity panel (task review §37) for
 * one breeding-decision run. Every field is AVAILABLE/NOT_ESTIMABLE/
 * DEFERRED with a reason whenever it is not AVAILABLE - never a
 * fabricated number to make the panel look more complete than the
 * underlying evidence actually supports. */
export function buildGeneticValidityPanel(params: {
  candidateRankingAvailable: boolean;
  multiEnvironmentStabilityAvailable: boolean;
  heritability:
    | { status: "ESTIMABLE"; h2: number }
    | { status: "NOT_ESTIMABLE"; reason: string }
    | null;
}): GeneticValidityPanel {
  return {
    candidateRanking: {
      status: params.candidateRankingAvailable ? "AVAILABLE" : "NOT_ESTIMABLE",
      reason: params.candidateRankingAvailable
        ? null
        : "Aucune méthode de sélection n'a produit un classement estimable pour ce scénario.",
    },
    selectionDifferential: { status: "AVAILABLE", reason: null },
    multiEnvironmentStability: {
      status: params.multiEnvironmentStabilityAvailable
        ? "AVAILABLE"
        : "NOT_ESTIMABLE",
      reason: params.multiEnvironmentStabilityAvailable
        ? null
        : "Aucun trait sélectionné ne provient d'une analyse de stabilité multi-environnement (WAASB/WAASBY) validée.",
    },
    broadSenseGenotypicResponse:
      params.heritability?.status === "ESTIMABLE"
        ? { status: "AVAILABLE", reason: null }
        : {
            status: "NOT_ESTIMABLE",
            reason:
              params.heritability?.status === "NOT_ESTIMABLE"
                ? params.heritability.reason
                : "L'héritabilité au sens large n'a pas été évaluée pour ce scénario.",
          },
    geneticCorrelation: {
      status: "NOT_ESTIMABLE",
      reason:
        "Aucun modèle de covariance génétique multi-traits validé n'est actuellement implémenté dans BreedOps (voir agend.md : selection_multitrait_covariance_v1 formellement différé).",
    },
    additiveBreedingValue: {
      status: "NOT_ESTIMABLE",
      reason: NO_ADDITIVE_MODEL_REASON,
    },
    expectedAdditiveGain: {
      status: "NOT_ESTIMABLE",
      reason: NO_ADDITIVE_MODEL_REASON,
    },
  };
}
