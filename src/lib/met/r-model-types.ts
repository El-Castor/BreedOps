// Pure constant/type only (no DB/network/subprocess access) - no
// "server-only" guard, so modules that need just the model-type allowlist
// (e.g. src/lib/met/eligibility.ts, to stay directly unit-testable) can
// import it without pulling in src/lib/met/r-runner.ts's subprocess code.

/** MUST match `ALLOWED_MODEL_TYPES` in `analytics-r/scripts/met_models.R`
 * exactly - this is the one allowlist of model specifications the R script
 * accepts; the client never supplies a formula or anything else that
 * controls what statistical model actually runs (B19: hand-rolled REML is
 * forbidden, and so is a client-controlled formula). */
export const MET_MODEL_TYPES = [
  "met_base_v1",
  "met_finlay_wilkinson_v1",
  "met_ammi_v1",
  "met_waasb_v1",
  "met_gge_v1",
] as const;
export type MetModelType = (typeof MET_MODEL_TYPES)[number];
