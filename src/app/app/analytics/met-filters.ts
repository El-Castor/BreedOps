// Plain helper module (NOT "use server") - same reason as ./filters.ts:
// every export of a "use server" file must itself be an async Server
// Action, so this synchronous FormData parser lives alongside it instead.
import { z } from "zod";

const uuid = z.string().uuid();

/** Only the model types met-actions.ts actually knows how to run today. */
const metModelTypeSchema = z.enum([
  "met_base_v1",
  "met_ammi_v1",
  "met_waasb_v1",
  "met_finlay_wilkinson_v1",
]);
export type MetRunModelType = z.infer<typeof metModelTypeSchema>;

const metRunInputSchema = z.object({
  programId: uuid,
  trialId: uuid,
  traitId: uuid,
  modelType: metModelTypeSchema,
  performanceWeight: z.number().min(0).max(1).nullable(),
});
export type MetRunInput = z.infer<typeof metRunInputSchema>;

export function metRunInputFromFormData(form: FormData): MetRunInput {
  const performanceWeightRaw = form.get("performance_weight");
  return metRunInputSchema.parse({
    programId: form.get("program_id"),
    trialId: form.get("trial_id"),
    traitId: form.get("trait_id"),
    modelType: form.get("model_type"),
    performanceWeight:
      performanceWeightRaw && typeof performanceWeightRaw === "string"
        ? Number(performanceWeightRaw)
        : null,
  });
}
