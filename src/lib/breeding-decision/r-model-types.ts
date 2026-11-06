// Pure module, no "server-only" guard - same convention as
// src/lib/met/r-model-types.ts, kept separate so r-runner.ts's own
// "server-only" import never leaks into a module that must stay directly
// unit-testable (e.g. eligibility.ts).
export const SELECTION_MODEL_TYPES = [
  "selection_mgidi_v1",
  "selection_mtsi_v1",
  "selection_smith_hazel_v1",
  "selection_multitrait_covariance_v1",
] as const;
export type SelectionModelType = (typeof SELECTION_MODEL_TYPES)[number];
