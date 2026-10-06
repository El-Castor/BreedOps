// Shared vocabulary for configurable phenotyping (labels only; validation and
// scoring stay in PostgreSQL).

export type Trait = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  data_type: string;
  unit: string | null;
  minimum_value: number | null;
  maximum_value: number | null;
  decimal_places: number | null;
  allowed_values: string[] | null;
  direction: string;
  target_value: number | null;
  protocol: string | null;
  is_active: boolean;
};

export type ActiveTrait = Omit<Trait, "id" | "is_active"> & {
  trait_id: string;
  module_id: string;
  module_name: string;
  module_order: number;
  trait_order: number;
  coefficient: number | null;
};

export const categoryLabels: Record<string, string> = {
  morphology: "Morphologie",
  development: "Développement",
  flowering: "Floraison",
  yield: "Rendement",
  quality: "Qualité",
  disease_resistance: "Résistance aux maladies",
  stress_tolerance: "Tolérance au stress",
  seed: "Semences",
  physiology: "Physiologie",
  architecture: "Architecture",
  other: "Autre",
};

export const typeLabels: Record<string, string> = {
  numeric: "Numérique",
  integer: "Entier",
  ordinal: "Ordinal",
  categorical: "Catégoriel",
  boolean: "Oui / non",
  date: "Date",
  text: "Texte",
};

export const directionLabels: Record<string, string> = {
  higher_is_better: "Plus élevé = meilleur",
  lower_is_better: "Plus faible = meilleur",
  target_value: "Valeur cible",
  neutral: "Observation neutre",
};

export const isRanged = (dataType: string) =>
  dataType === "numeric" || dataType === "integer" || dataType === "ordinal";

export function formatRange(trait: {
  data_type: string;
  minimum_value: number | null;
  maximum_value: number | null;
  unit: string | null;
  allowed_values: string[] | null;
}) {
  if (trait.data_type === "categorical")
    return (trait.allowed_values ?? []).join(" · ");
  if (trait.data_type === "boolean") return "Oui / Non";
  if (!isRanged(trait.data_type)) return "—";
  if (trait.minimum_value == null && trait.maximum_value == null) return "—";
  const unit = trait.unit ? ` ${trait.unit}` : "";
  return `${trait.minimum_value ?? "…"} – ${trait.maximum_value ?? "…"}${unit}`;
}

export function formatObservation(
  value: {
    numeric_value: number | null;
    text_value: string | null;
    boolean_value: boolean | null;
    date_value: string | null;
  },
  unit: string | null,
) {
  if (value.numeric_value != null)
    return `${value.numeric_value}${unit ? ` ${unit}` : ""}`;
  if (value.boolean_value != null) return value.boolean_value ? "Oui" : "Non";
  if (value.date_value) {
    const [year, month, day] = value.date_value.split("-");
    return `${day}/${month}/${year}`;
  }
  return value.text_value ?? "—";
}

/** Input step for a measured trait (respects decimal precision). */
export function inputStep(trait: {
  data_type: string;
  decimal_places: number | null;
}) {
  if (trait.data_type !== "numeric") return "1";
  return trait.decimal_places == null
    ? "any"
    : String(10 ** -trait.decimal_places);
}
