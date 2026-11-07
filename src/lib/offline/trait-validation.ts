import type { OfflineTraitDefinition } from "./types";

export interface TraitValidationResult {
  ok: boolean;
  message?: string;
  value?: string | number | boolean;
}

/** Client-side mirror of submit_trait_evaluation()'s own per-trait rules
 * (supabase/migrations/000016_configurable_phenotyping.sql), for immediate
 * field-entry feedback only (V2-07 §6: "client validation mirrors server
 * rules for immediate UX; server validation remains authoritative at
 * synchronization time"). This never substitutes for that server-side
 * check - submit_offline_phenotype_evaluation() (migration 000035) always
 * re-validates unconditionally through submit_trait_evaluation() itself at
 * sync time, so a mismatch here only costs UX, never correctness. `raw` is
 * whatever the form control produced: a string from a text/number/date
 * input, or a boolean from a checkbox. */
export function validateTraitValue(
  trait: OfflineTraitDefinition,
  raw: string | boolean | undefined,
): TraitValidationResult {
  if (raw === undefined || raw === "") {
    return { ok: true, value: undefined };
  }

  if (
    trait.dataType === "numeric" ||
    trait.dataType === "integer" ||
    trait.dataType === "ordinal"
  ) {
    const numeric = typeof raw === "string" ? Number(raw) : NaN;
    if (typeof raw !== "string" || raw.trim() === "" || Number.isNaN(numeric)) {
      return { ok: false, message: "Valeur numérique requise." };
    }
    if (trait.dataType !== "numeric" && numeric !== Math.trunc(numeric)) {
      return { ok: false, message: "Un nombre entier est requis." };
    }
    if (
      (trait.minimumValue !== null && numeric < trait.minimumValue) ||
      (trait.maximumValue !== null && numeric > trait.maximumValue)
    ) {
      return {
        ok: false,
        message: `Valeur hors limites (${trait.minimumValue ?? "–∞"} à ${trait.maximumValue ?? "+∞"}).`,
      };
    }
    if (
      trait.decimalPlaces !== null &&
      numeric !== Number(numeric.toFixed(trait.decimalPlaces))
    ) {
      return {
        ok: false,
        message: `Au maximum ${trait.decimalPlaces} décimale(s).`,
      };
    }
    return { ok: true, value: numeric };
  }

  if (trait.dataType === "boolean") {
    if (typeof raw !== "boolean") {
      return { ok: false, message: "Valeur booléenne requise." };
    }
    return { ok: true, value: raw };
  }

  if (trait.dataType === "date") {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { ok: false, message: "Date invalide (AAAA-MM-JJ)." };
    }
    return { ok: true, value: raw };
  }

  if (trait.dataType === "categorical") {
    if (typeof raw !== "string" || !(trait.allowedValues ?? []).includes(raw)) {
      return { ok: false, message: "Valeur non autorisée pour ce trait." };
    }
    return { ok: true, value: raw };
  }

  // text / anything else
  if (typeof raw !== "string") {
    return { ok: false, message: "Texte requis." };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 1000) {
    return { ok: false, message: "Texte entre 1 et 1000 caractères." };
  }
  return { ok: true, value: trimmed };
}
