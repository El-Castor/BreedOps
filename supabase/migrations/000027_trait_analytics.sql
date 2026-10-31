-- V2-04: Trait Analytics & Longitudinal Stability.
-- Additive only; 000001-000026 are left untouched.
--
-- This migration adds exactly one new entity, analytics_runs: a reproducible
-- provenance record for an explicitly saved trait-analysis snapshot. It does
-- NOT add any new scientific source table, and it never mutates existing
-- phenotyping data (phenotypes / phenotype_evaluations / phenotype_trait_values
-- / phenotype_traits are read-only inputs to analytics; see
-- docs/ANALYTICS.md).
--
-- Design decisions (full rationale in docs/ANALYTICS.md and agend.md):
--  * One analysis_type ('trait_intelligence') for V2-04: the engine computes
--    one coherent per-trait bundle (descriptive stats, QC/outliers,
--    longitudinal trajectory + derived features, rank stability,
--    repeatability, pairwise associations, early-proxy evidence) scoped by
--    `specification`. Splitting this into five separate row-level analysis
--    types would not make any of them independently reproducible (they all
--    share one dataset fingerprint) and would only fragment provenance.
--  * `specification` and `result` are validated, versioned JSONB structures
--    (never an arbitrary blob): specification is the exact, already-validated
--    filter/parameter set the server used to build the dataset; result is a
--    compact structured SUMMARY (counts, estimates, eligibility diagnostics,
--    a bounded outlier list) - never the full per-row dataset. Both are
--    size-capped below so a bug can never turn this table into a raw-data
--    dump.
--  * `dataset_fingerprint` is a sha256 hex digest (deterministic, see
--    src/lib/analytics/fingerprint.ts) over the canonically-ordered
--    (evaluation_id, trait_id, phenotype_id, evaluation_date, numeric_value)
--    tuples that fed the analysis. It lets the UI detect staleness later
--    (same specification, different fingerprint now) WITHOUT re-deriving
--    biological meaning from a cache - see read-time staleness check in
--    src/lib/analytics/actions.ts; nothing here recomputes it automatically.
--  * No UPDATE and no DELETE policy: a saved analysis is a fact about what
--    was computed, when, from what data and by which engine. If the
--    underlying data or the question changes, a NEW run is created; an old
--    one is never edited in place. This makes every provenance field
--    trivially immutable (there is no write path that could change it).
--  * organization_id/program_id are re-derived from the trait/program server
--    side and cross-checked by trigger exactly like every other
--    target-validated table in this schema (media_assets, notifications) -
--    never trusted as a bare client-supplied pair.

CREATE TABLE public.analytics_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL DEFAULT 'trait_intelligence'
    CHECK (analysis_type IN ('trait_intelligence')),
  trait_id UUID NOT NULL REFERENCES public.phenotype_traits(id) ON DELETE CASCADE,
  secondary_trait_id UUID REFERENCES public.phenotype_traits(id) ON DELETE CASCADE,

  spec_version TEXT NOT NULL DEFAULT '1' CHECK (char_length(spec_version) <= 20),
  specification JSONB NOT NULL CHECK (octet_length(specification::text) <= 20000),
  dataset_fingerprint TEXT NOT NULL CHECK (dataset_fingerprint ~ '^[0-9a-f]{64}$'),

  status TEXT NOT NULL CHECK (status IN ('completed', 'not_estimable', 'failed')),
  result JSONB CHECK (result IS NULL OR octet_length(result::text) <= 200000),
  n_observations INTEGER CHECK (n_observations IS NULL OR n_observations >= 0),

  engine_name TEXT NOT NULL CHECK (char_length(engine_name) BETWEEN 1 AND 80),
  engine_version TEXT NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 40),

  started_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT analytics_runs_completed_after_started
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);
COMMENT ON TABLE public.analytics_runs IS
  'Reproducible provenance record for an explicitly saved trait-analysis snapshot. Read-only relative to scientific source data; never mutated after insert (no UPDATE/DELETE policy).';
COMMENT ON COLUMN public.analytics_runs.specification IS
  'The exact, server-validated filter/parameter set used to build the analysis dataset (program, trait(s), date range, optional family/seed-lot/block/replicate/location filters, archived-inclusion choice, early/late proxy windows). Size-capped; never raw observations.';
COMMENT ON COLUMN public.analytics_runs.result IS
  'Compact structured summary of the computed analysis (counts, estimates, eligibility diagnostics, a bounded outlier list) - never the full per-row dataset. Size-capped.';
COMMENT ON COLUMN public.analytics_runs.dataset_fingerprint IS
  'sha256 hex digest over the canonically-ordered observation tuples that fed this run, so a later read can detect that the underlying data has since changed (see src/lib/analytics/fingerprint.ts).';

CREATE INDEX analytics_runs_program_idx ON public.analytics_runs(program_id, trait_id, created_at DESC);
CREATE INDEX analytics_runs_org_idx ON public.analytics_runs(organization_id);

-- Re-derive organization_id from the program (never trust the client's pair)
-- and cross-check both traits belong to that same organization - the exact
-- pattern already used by validate_media_asset_target() (migration 000018)
-- and validate_phenotyping_composition() (migration 000016).
CREATE FUNCTION public.validate_analytics_run_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resolved_org UUID;
  trait_org UUID;
BEGIN
  SELECT organization_id INTO resolved_org FROM programs
  WHERE id = NEW.program_id AND deleted_at IS NULL;
  IF resolved_org IS NULL THEN
    RAISE EXCEPTION 'Analytics run program could not be resolved' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := resolved_org;

  SELECT organization_id INTO trait_org FROM phenotype_traits WHERE id = NEW.trait_id;
  IF trait_org IS NULL OR trait_org IS DISTINCT FROM resolved_org THEN
    RAISE EXCEPTION 'trait_id must belong to the same organization as the program' USING ERRCODE = '23514';
  END IF;

  IF NEW.secondary_trait_id IS NOT NULL THEN
    SELECT organization_id INTO trait_org FROM phenotype_traits WHERE id = NEW.secondary_trait_id;
    IF trait_org IS NULL OR trait_org IS DISTINCT FROM resolved_org THEN
      RAISE EXCEPTION 'secondary_trait_id must belong to the same organization as the program' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_analytics_run_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_analytics_run_scope_trigger BEFORE INSERT ON public.analytics_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_analytics_run_scope();

ALTER TABLE public.analytics_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_runs_read ON public.analytics_runs FOR SELECT
  USING (can_access_team(organization_id));
-- can_write_program is also required (not just can_write_team) so a run can
-- never be attached to a program outside the caller's own team even before
-- the trigger re-derives organization_id - the same belt-and-suspenders
-- pattern program_phenotyping_modules already uses.
CREATE POLICY analytics_runs_insert ON public.analytics_runs FOR INSERT
  WITH CHECK (can_write_team(organization_id) AND can_write_program(program_id));
-- No UPDATE, no DELETE policy: an analysis run is immutable provenance.

-- authenticated otherwise inherits this schema's default UPDATE/DELETE
-- privilege on every new table (the same reason every other table in this
-- schema either grants UPDATE itself under its own RLS policy, or - like
-- here - never grants it at all): without this explicit REVOKE, an
-- UPDATE/DELETE with no matching policy would still be denied by RLS, but
-- only as a silent 0-row no-op rather than a real permission error. An
-- analysis run's immutability is a stated design invariant (see the header
-- comment above), so it is enforced at the privilege layer directly rather
-- than left to an RLS side-effect.
REVOKE ALL ON public.analytics_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.analytics_runs TO authenticated;

-- ───────────────────────── Canonical observation dataset ─────────────────────────
-- The ONE server-side reader every V2-04 analysis is built from (task §7):
-- no chart or action queries phenotype_trait_values/phenotype_evaluations/
-- phenotypes directly. SECURITY INVOKER (not DEFINER): it runs under the
-- caller's own role, so the pre-existing RLS policies on all three joined
-- tables still apply in full; the explicit can_access_program() check below
-- is an additional, redundant guard (the same belt-and-suspenders pattern
-- program_active_traits already uses), not a replacement for RLS. Only
-- numeric/integer/ordinal traits are accepted - categorical/boolean/date/
-- text traits are never fed into a numeric model (task §7/§34). Rows are
-- capped server-side (LEAST(row_limit, 5000)) so a request can never pull
-- an organization's entire phenotyping history into the application
-- (task §40); the cap is enforced here even if a caller passes a larger
-- row_limit.
CREATE FUNCTION public.trait_observation_dataset(
  target_program_id UUID,
  target_trait_id UUID,
  date_from DATE DEFAULT NULL,
  date_to DATE DEFAULT NULL,
  filter_family_ids UUID[] DEFAULT NULL,
  filter_seed_lot_ids UUID[] DEFAULT NULL,
  filter_blocks TEXT[] DEFAULT NULL,
  filter_replicates INTEGER[] DEFAULT NULL,
  filter_locations TEXT[] DEFAULT NULL,
  include_archived BOOLEAN DEFAULT FALSE,
  row_limit INTEGER DEFAULT 5000
)
RETURNS TABLE (
  trait_value_id UUID,
  numeric_value NUMERIC,
  evaluation_id UUID,
  evaluation_date DATE,
  evaluator_id UUID,
  phenotype_id UUID,
  phenotype_code TEXT,
  family_id UUID,
  seed_lot_id UUID,
  block TEXT,
  replicate INTEGER,
  location TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    tv.id, tv.numeric_value,
    e.id, e.evaluation_date, e.evaluator_id,
    p.id, p.phenotype_code, p.family_id, p.seed_lot_id,
    p.block, p.replicate, p.location
  FROM phenotype_trait_values tv
  JOIN phenotype_evaluations e ON e.id = tv.phenotype_evaluation_id
  JOIN phenotypes p ON p.id = e.phenotype_id
  WHERE tv.trait_id = target_trait_id
    AND tv.numeric_value IS NOT NULL
    AND p.program_id = target_program_id
    AND can_access_program(target_program_id)
    AND EXISTS (
      SELECT 1 FROM phenotype_traits t
      WHERE t.id = target_trait_id AND t.data_type IN ('numeric', 'integer', 'ordinal')
    )
    AND (include_archived OR (p.deleted_at IS NULL AND e.deleted_at IS NULL))
    AND (date_from IS NULL OR e.evaluation_date >= date_from)
    AND (date_to IS NULL OR e.evaluation_date <= date_to)
    AND (filter_family_ids IS NULL OR p.family_id = ANY (filter_family_ids))
    AND (filter_seed_lot_ids IS NULL OR p.seed_lot_id = ANY (filter_seed_lot_ids))
    AND (filter_blocks IS NULL OR p.block = ANY (filter_blocks))
    AND (filter_replicates IS NULL OR p.replicate = ANY (filter_replicates))
    AND (filter_locations IS NULL OR p.location = ANY (filter_locations))
  ORDER BY e.evaluation_date NULLS LAST, tv.id
  LIMIT LEAST(COALESCE(row_limit, 5000), 5000);
$$;
REVOKE ALL ON FUNCTION public.trait_observation_dataset(
  UUID, UUID, DATE, DATE, UUID[], UUID[], TEXT[], INTEGER[], TEXT[], BOOLEAN, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trait_observation_dataset(
  UUID, UUID, DATE, DATE, UUID[], UUID[], TEXT[], INTEGER[], TEXT[], BOOLEAN, INTEGER
) TO authenticated;

-- Sibling of trait_observation_dataset, scoped to the SAME cohort (program +
-- date range + archived-inclusion) but NOT to one trait: every evaluation
-- event for a matching phenotype, whether or not it carries a value for the
-- trait being analyzed. This is what makes a real "n missing" meaningful
-- (task §11): BreedOps does not require every evaluation to score every
-- active trait (submit_trait_evaluation, migration 000016, accepts a
-- partial submission), so "missing" here means "a scoring event happened
-- for this phenotype in this window, but not for this particular trait" -
-- never an invented denominator.
CREATE FUNCTION public.program_evaluation_dataset(
  target_program_id UUID,
  date_from DATE DEFAULT NULL,
  date_to DATE DEFAULT NULL,
  include_archived BOOLEAN DEFAULT FALSE,
  row_limit INTEGER DEFAULT 5000
)
RETURNS TABLE (
  evaluation_id UUID,
  phenotype_id UUID,
  family_id UUID,
  seed_lot_id UUID,
  block TEXT,
  replicate INTEGER,
  location TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT e.id, p.id, p.family_id, p.seed_lot_id, p.block, p.replicate, p.location
  FROM phenotype_evaluations e
  JOIN phenotypes p ON p.id = e.phenotype_id
  WHERE p.program_id = target_program_id
    AND can_access_program(target_program_id)
    AND (include_archived OR (p.deleted_at IS NULL AND e.deleted_at IS NULL))
    AND (date_from IS NULL OR e.evaluation_date >= date_from)
    AND (date_to IS NULL OR e.evaluation_date <= date_to)
  ORDER BY e.id
  LIMIT LEAST(COALESCE(row_limit, 5000), 5000);
$$;
REVOKE ALL ON FUNCTION public.program_evaluation_dataset(UUID, DATE, DATE, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_evaluation_dataset(UUID, DATE, DATE, BOOLEAN, INTEGER) TO authenticated;
