-- V2-05 scientific hardening (independent review blocker #3):
-- met_observation_dataset() previously returned every dated evaluation for
-- a trial/trait regardless of evaluation_date. A phenotype (one physical
-- Entry×Environment unit) measured on several different dates for the
-- same trait - a longitudinal/repeated measurement of that SAME unit -
-- would then enter a G×E model as if each date were an independent
-- replicate: true pseudo-replication, silently inflating/deflating the
-- Entry×Environment and residual variance estimates (see
-- src/lib/met/eligibility.ts's met_base_v1 replication check, which this
-- bug could otherwise be fed past).
--
-- Fix: add an explicit, optional target_evaluation_date filter. The SQL
-- function itself stays a faithful raw reader (it does not decide
-- ambiguity) - detecting "this phenotype has 2+ distinct dates" and
-- requiring the caller to pick one before modelling is
-- src/lib/met/design-summary.ts's detectMetLongitudinalAmbiguity() /
-- src/lib/met/eligibility.ts's evaluateMetOccasionEligibility(), run
-- against an UNFILTERED fetch before any scoped fetch is made. Pushing the
-- actual filter into SQL (rather than filtering an already-fetched row
-- array in TypeScript) keeps the existing N+1 row-cap overflow-detection
-- correct for the scoped occasion, not for the whole unfiltered trial.
--
-- The function's parameter list changes (a new parameter, even with a
-- default, is a different signature to Postgres), so the old 4-arg
-- function is dropped and replaced rather than "CREATE OR REPLACE"d over -
-- that would otherwise leave two overloaded functions behind. Additive
-- migration; 000001-000030 are left untouched.
DROP FUNCTION IF EXISTS public.met_observation_dataset(UUID, UUID, BOOLEAN, INTEGER);

CREATE FUNCTION public.met_observation_dataset(
  target_trial_id UUID,
  target_trait_id UUID,
  include_archived BOOLEAN DEFAULT FALSE,
  row_limit INTEGER DEFAULT 5001,
  target_evaluation_date DATE DEFAULT NULL
)
RETURNS TABLE (
  trait_value_id UUID,
  numeric_value NUMERIC,
  evaluation_id UUID,
  evaluation_date DATE,
  phenotype_id UUID,
  phenotype_code TEXT,
  entry_id UUID,
  entry_code TEXT,
  entry_label TEXT,
  entry_scientific_role TEXT,
  environment_id UUID,
  environment_code TEXT,
  site_id UUID,
  site_code TEXT,
  campaign TEXT,
  block TEXT,
  replicate INTEGER
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    tv.id, tv.numeric_value,
    e.id, e.evaluation_date,
    p.id, p.phenotype_code,
    te.id, te.code, te.label, te.scientific_role,
    env.id, env.code, env.site_id, s.code, env.campaign,
    p.block, p.replicate
  FROM phenotype_trait_values tv
  JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id
  JOIN phenotypes p ON p.id = e.phenotype_id
  JOIN trial_entries te ON te.id = p.trial_entry_id
  JOIN environments env ON env.id = p.environment_id
  JOIN sites s ON s.id = env.site_id
  JOIN trials t ON t.id = te.trial_id
  JOIN trial_environments tev ON tev.trial_id = t.id AND tev.environment_id = env.id
  WHERE te.trial_id = target_trial_id
    AND tv.trait_id = target_trait_id
    AND tv.numeric_value IS NOT NULL
    AND can_access_program(t.program_id)
    AND (target_evaluation_date IS NULL OR e.evaluation_date = target_evaluation_date)
    AND EXISTS (
      SELECT 1 FROM phenotype_traits tr
      WHERE tr.id = target_trait_id AND tr.data_type IN ('numeric', 'integer', 'ordinal')
    )
    AND (include_archived OR (p.deleted_at IS NULL AND e.deleted_at IS NULL
      AND te.deleted_at IS NULL AND env.deleted_at IS NULL))
  ORDER BY env.code, e.evaluation_date NULLS LAST, tv.id
  LIMIT LEAST(COALESCE(row_limit, 5001), 5001);
$$;
REVOKE ALL ON FUNCTION public.met_observation_dataset(UUID, UUID, BOOLEAN, INTEGER, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.met_observation_dataset(UUID, UUID, BOOLEAN, INTEGER, DATE) TO authenticated;
COMMENT ON FUNCTION public.met_observation_dataset IS
  'The one server-side reader every V2-05 multi-environment analysis is built from. SECURITY INVOKER: caller''s own RLS on every joined table still applies; can_access_program() is an additional, redundant guard. LIMIT LEAST(row_limit, 5001) mirrors trait_observation_dataset''s N+1 overflow-detection pattern - never a silently truncated dataset. target_evaluation_date (added in 000031) restricts the result to one explicit measurement occasion; required by the caller whenever the same phenotype has more than one dated evaluation for this trait (src/lib/met/design-summary.ts''s detectMetLongitudinalAmbiguity), so repeated measurements of the same Entry×Environment unit are never silently pooled as if they were independent replicates.';
