// Explicit, documented eligibility thresholds and the heritability refusal
// (task §2 / §25 / §31): every number here is a named constant, never a
// silent magic number inside a formula, and every refusal states exactly
// why.

export const MIN_RANK_STABILITY_PAIRED_N = 8;
export const MAX_RANK_STABILITY_TIMEPOINTS = 6;
export const MAX_INDIVIDUAL_TRAJECTORIES = 25;
export const MIN_ASSOCIATION_PAIRED_N = 8;
export const MIN_WITHIN_ENTITY_OBSERVATIONS = 3;

export const HERITABILITY_NOT_ESTIMABLE_REASONS = [
  "Aucune entité « génotype » explicite n’existe dans le modèle actuel : family_id/seed_lot_id identifient un regroupement de sélection (famille, lot de semences), pas une identité génétique individuelle confirmée et répétée (clone, lignée pure).",
  "block/replicate sont des champs texte/entier libres sur chaque phénotype, non rattachés à un plan expérimental validé (randomisation, blocs complets, etc.) permettant de séparer la variance génétique de la variance environnementale.",
  "Aucun modèle d’environnement normalisé n’existe (location est un champ texte libre) : l’hérédité au sens strict suppose de distinguer l’effet génétique de l’effet de l’environnement, ce que le schéma actuel ne permet pas d’identifier de façon fiable.",
] as const;
