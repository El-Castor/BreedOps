// Plain helper module (NOT "use server") - same reason as ./met-filters.ts:
// every export of a "use server" file must itself be an async Server
// Action, so these synchronous FormData parsers live alongside it instead.
import { z } from "zod";

const uuid = z.string().uuid();

export const BREEDING_SOURCE_TYPE_VALUES = [
  "RAW_PHENOTYPIC",
  "PHENOTYPIC_MEAN",
  "MET_ENTRY_PREDICTION",
  "WAASBY_STABILITY_PERFORMANCE",
] as const;
const sourceTypeSchema = z.enum(BREEDING_SOURCE_TYPE_VALUES);

const directionSchema = z.enum([
  "higher_is_better",
  "lower_is_better",
  "target_value",
]);

const breedingScenarioInputSchema = z.object({
  programId: uuid,
  trialId: uuid,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  candidateEligibility: z.enum(["all", "exclude_operationally_eliminated"]),
  selectionProportion: z.number().gt(0).max(100),
});
export type BreedingScenarioInput = z.infer<typeof breedingScenarioInputSchema>;

function optionalString(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function breedingScenarioInputFromFormData(
  form: FormData,
): BreedingScenarioInput {
  return breedingScenarioInputSchema.parse({
    programId: form.get("program_id"),
    trialId: form.get("trial_id"),
    name: form.get("name"),
    description: optionalString(form, "description"),
    candidateEligibility: form.get("candidate_eligibility") ?? "all",
    selectionProportion: Number(form.get("selection_proportion")),
  });
}

const breedingScenarioTraitInputSchema = z.object({
  scenarioId: uuid,
  traitId: uuid,
  direction: directionSchema,
  targetValue: z.number().nullable(),
  weight: z.number().min(0).nullable(),
  economicWeight: z.number().nullable(),
  sourceType: sourceTypeSchema,
  sourceRunId: uuid.nullable(),
  evaluationDate: z.string().date().nullable(),
});
export type BreedingScenarioTraitInput = z.infer<
  typeof breedingScenarioTraitInputSchema
>;

function optionalNumber(form: FormData, name: string): number | null {
  const raw = optionalString(form, name);
  return raw === null ? null : Number(raw);
}

export function breedingScenarioTraitInputFromFormData(
  form: FormData,
): BreedingScenarioTraitInput {
  return breedingScenarioTraitInputSchema.parse({
    scenarioId: form.get("scenario_id"),
    traitId: form.get("trait_id"),
    direction: form.get("direction"),
    targetValue: optionalNumber(form, "target_value"),
    weight: optionalNumber(form, "weight"),
    economicWeight: optionalNumber(form, "economic_weight"),
    sourceType: form.get("source_type"),
    sourceRunId: optionalString(form, "source_run_id"),
    evaluationDate: optionalString(form, "evaluation_date"),
  });
}

const breedingRunInputSchema = z.object({
  programId: uuid,
  scenarioId: uuid,
  method: z.enum(["selection_mgidi_v1", "selection_mtsi_v1"]),
});
export type BreedingRunInput = z.infer<typeof breedingRunInputSchema>;

export function breedingRunInputFromFormData(form: FormData): BreedingRunInput {
  return breedingRunInputSchema.parse({
    programId: form.get("program_id"),
    scenarioId: form.get("scenario_id"),
    method: form.get("method"),
  });
}
