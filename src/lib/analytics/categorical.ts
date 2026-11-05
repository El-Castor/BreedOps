// Pure functions only - categorical/boolean trait summaries (task §5: the
// requested V2-04 scope includes non-numeric descriptive handling). Never
// mean/SD/ICC/Pearson/longitudinal models here - those are only valid for
// numeric/integer/ordinal data; see src/lib/analytics/analysis.ts for that
// path. Uses the same "coverage" terminology as DescriptiveStats (never
// "missing") for the identical reason: submit_trait_evaluation (migration
// 000016) accepts a partial submission, so a trait's absence from an
// evaluation does not prove a missing measurement.

import type { CategoricalObservationRecord, CategoricalSummary } from "./types";

export function computeCategoricalSummary(
  rows: CategoricalObservationRecord[],
  trait: {
    traitId: string;
    code: string;
    name: string;
    dataType: "categorical" | "boolean";
    allowedValues: string[] | null;
  },
  nEvaluationEvents: number,
): CategoricalSummary {
  const counts = new Map<string, number>();
  if (trait.dataType === "boolean") {
    counts.set("Oui", 0);
    counts.set("Non", 0);
    for (const row of rows) {
      if (row.booleanValue == null) continue;
      const label = row.booleanValue ? "Oui" : "Non";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  } else {
    for (const label of trait.allowedValues ?? []) counts.set(label, 0);
    for (const row of rows) {
      if (row.textValue == null) continue;
      counts.set(row.textValue, (counts.get(row.textValue) ?? 0) + 1);
    }
  }
  const nObserved = rows.length;
  const categories = [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    proportion: nObserved > 0 ? count / nObserved : 0,
  }));
  return {
    traitId: trait.traitId,
    traitCode: trait.code,
    traitName: trait.name,
    dataType: trait.dataType,
    nEvaluationEvents,
    nObserved,
    nEvaluationEventsWithoutTrait: nEvaluationEvents - nObserved,
    coverageRatio: nEvaluationEvents > 0 ? nObserved / nEvaluationEvents : null,
    categories,
  };
}
