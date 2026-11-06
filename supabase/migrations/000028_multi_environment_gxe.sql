-- V2-05: Multi-environment trial analytics & G x E stability.
-- Additive only; 000001-000027 are left untouched.
--
-- Scope and design decisions (full rationale in docs/ANALYTICS.md and agend.md):
--  * `experimental_cycles` (migration 000001) was audited first and found to
--    be an operations/scheduling concept (name/start_date/end_date/status,
--    referenced only by `tasks`) with no site dimension and no link at all
--    to phenotype data - not the scientific MET entity this milestone
--    needs. A genuinely new, normalized model is introduced instead of
--    overloading it.
--  * `sites` (new): a normalized physical/organizational location, distinct
--    from the existing free-text `phenotypes.location`, which is preserved
--    unchanged for backward compatibility (never auto-migrated into a
--    site/environment - see B8/B41, and the explicit mapping workflow in
--    the UI).
--  * `environments` (new): one MET environment = one site observed in one
--    campaign/context. `campaign` reuses the exact same free-text
--    season/year convention already established by `programs.campaign`
--    (V2-04's dashboard already groups by it) rather than inventing a
--    second, competing representation.
--  * `trials` + `trial_environments` (new): a named multi-environment trial
--    is an explicit set of environments within one program. A trial does
--    not itself carry a trait or dataset - that scoping happens the same
--    way V2-04 scopes by program+trait, at analysis time.
--  * `trial_entries` (new): the explicit experimental-material identity
--    compared across environments, with a mandatory `scientific_role`
--    (task review: "Do not call an entry a genotype unless the user/data
--    explicitly defines it as such"). An entry MAY reference an existing
--    parent_line/family/seed_lot for traceability, but the role is always
--    stated explicitly, never inferred from which FK happens to be set.
--  * `phenotypes.environment_id`/`phenotypes.trial_entry_id` (new, nullable):
--    additive links only - every existing phenotype row keeps working
--    exactly as before with both NULL. Raw phenotype/evaluation/trait-value
--    data is never rewritten by this migration or by any V2-05 analysis
--    (same immutability guarantee V2-04 relies on).
--  * `analytics_runs.analysis_type` gains 'multi_environment' (sibling of
--    V2-04's 'trait_intelligence', not a replacement); `trial_id` is
--    nullable and required exactly when analysis_type='multi_environment'.
--    The statistical engine/version actually used (R, sommer, metan)
--    reuses the already-generic `engine_name`/`engine_version` columns
--    V2-04 defined, plus `result` for the versioned per-package detail -
--    no new provenance table, no parallel provenance mechanism.
--  * `met_observation_dataset()` is the ONE server-side MET reader, mirroring
--    V2-04's `trait_observation_dataset()`: SECURITY INVOKER, every filter
--    applied before the same N+1 row-cap overflow-detection pattern
--    (LIMIT LEAST(row_limit, 5001)), so "dataset too large" is a
--    deterministic, non-silent refusal rather than a truncated prefix.

-- ───────────────────────── Sites ─────────────────────────
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  latitude NUMERIC CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude NUMERIC CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  UNIQUE (organization_id, code)
);
COMMENT ON TABLE public.sites IS
  'Normalized physical/organizational location a trial environment happens at. Geographical metadata is optional - never inferred, never required.';

CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
-- deleted_at is NOT in this USING clause: it is lifecycle state, not an
-- authorization boundary, matching the established convention (see
-- 000022_business_completion.sql §E on selection_criteria_read for the full
-- rationale) - an archived site must stay readable so it can be restored,
-- and a plain `UPDATE ... SET deleted_at = now()` would otherwise be
-- rejected because PostgreSQL re-checks the SELECT policy against the
-- post-UPDATE row.
CREATE POLICY sites_read ON public.sites FOR SELECT
  USING (can_access_team(organization_id));
CREATE POLICY sites_insert ON public.sites FOR INSERT
  WITH CHECK (can_write_team(organization_id));
CREATE POLICY sites_update ON public.sites FOR UPDATE
  USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));
REVOKE ALL ON public.sites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sites TO authenticated;

-- ───────────────────────── Environments ─────────────────────────
CREATE TABLE public.environments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  campaign TEXT CHECK (campaign IS NULL OR char_length(campaign) <= 40),
  management_context TEXT CHECK (management_context IS NULL OR char_length(management_context) <= 2000),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  UNIQUE (program_id, code)
);
COMMENT ON TABLE public.environments IS
  'One MET environment = one site observed under one campaign/management context. The normalized counterpart to the legacy free-text phenotypes.location, which this never auto-replaces (see the explicit mapping workflow, B41).';

CREATE TRIGGER update_environments_updated_at BEFORE UPDATE ON public.environments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE FUNCTION public.validate_environment_site_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  program_org UUID;
  site_org UUID;
BEGIN
  SELECT organization_id INTO program_org FROM programs WHERE id = NEW.program_id AND deleted_at IS NULL;
  IF program_org IS NULL THEN
    RAISE EXCEPTION 'Environment program could not be resolved' USING ERRCODE = '23514';
  END IF;
  SELECT organization_id INTO site_org FROM sites WHERE id = NEW.site_id AND deleted_at IS NULL;
  IF site_org IS NULL OR site_org IS DISTINCT FROM program_org THEN
    RAISE EXCEPTION 'site_id must belong to the same organization as the program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_environment_site_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_environment_site_scope_trigger BEFORE INSERT OR UPDATE OF program_id, site_id ON public.environments
  FOR EACH ROW EXECUTE FUNCTION public.validate_environment_site_scope();

ALTER TABLE public.environments ENABLE ROW LEVEL SECURITY;
-- deleted_at intentionally not checked here either - same rationale as
-- sites_read above.
CREATE POLICY environments_read ON public.environments FOR SELECT
  USING (can_access_program(program_id));
CREATE POLICY environments_insert ON public.environments FOR INSERT
  WITH CHECK (can_write_program(program_id));
CREATE POLICY environments_update ON public.environments FOR UPDATE
  USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
REVOKE ALL ON public.environments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.environments TO authenticated;

-- ───────────────────────── Trials ─────────────────────────
CREATE TABLE public.trials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  UNIQUE (program_id, code)
);
COMMENT ON TABLE public.trials IS
  'A named multi-environment trial: an explicit set of environments (trial_environments) and entries (trial_entries) within one program, analyzed together for G x E / stability.';

CREATE TRIGGER update_trials_updated_at BEFORE UPDATE ON public.trials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.trials ENABLE ROW LEVEL SECURITY;
-- deleted_at intentionally not checked here either - same rationale as
-- sites_read above.
CREATE POLICY trials_read ON public.trials FOR SELECT
  USING (can_access_program(program_id));
CREATE POLICY trials_insert ON public.trials FOR INSERT
  WITH CHECK (can_write_program(program_id));
CREATE POLICY trials_update ON public.trials FOR UPDATE
  USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
REVOKE ALL ON public.trials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trials TO authenticated;

-- Join table: which environments belong to which trial. No own
-- organization_id/program_id - RLS derives scope by joining to trials, and
-- the trigger below additionally cross-checks the environment's own
-- program matches the trial's program (an environment from a different
-- program could otherwise be joined to a trial despite each table's own
-- RLS independently allowing it, since RLS alone cannot cross-validate two
-- different foreign keys against each other).
CREATE TABLE public.trial_environments (
  trial_id UUID NOT NULL REFERENCES public.trials(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES public.environments(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (trial_id, environment_id)
);
COMMENT ON TABLE public.trial_environments IS
  'Which environments belong to which multi-environment trial. Cross-checked by trigger against trials.program_id = environments.program_id.';

CREATE FUNCTION public.validate_trial_environment_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  trial_program UUID;
  env_program UUID;
BEGIN
  SELECT program_id INTO trial_program FROM trials WHERE id = NEW.trial_id AND deleted_at IS NULL;
  SELECT program_id INTO env_program FROM environments WHERE id = NEW.environment_id AND deleted_at IS NULL;
  IF trial_program IS NULL OR env_program IS NULL OR trial_program IS DISTINCT FROM env_program THEN
    RAISE EXCEPTION 'A trial can only include environments from its own program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_trial_environment_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_trial_environment_scope_trigger BEFORE INSERT OR UPDATE ON public.trial_environments
  FOR EACH ROW EXECUTE FUNCTION public.validate_trial_environment_scope();

ALTER TABLE public.trial_environments ENABLE ROW LEVEL SECURITY;
CREATE POLICY trial_environments_read ON public.trial_environments FOR SELECT
  USING (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_access_program(trials.program_id)));
CREATE POLICY trial_environments_insert ON public.trial_environments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_write_program(trials.program_id)));
CREATE POLICY trial_environments_delete ON public.trial_environments FOR DELETE
  USING (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_write_program(trials.program_id)));
REVOKE ALL ON public.trial_environments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.trial_environments TO authenticated;

-- ───────────────────────── Trial entries ─────────────────────────
-- The explicit experimental-material identity being compared across
-- environments. scientific_role is always stated, never inferred from
-- which optional FK happens to be set (task review: never call an entry a
-- genotype unless the data explicitly says so).
CREATE TABLE public.trial_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trial_id UUID NOT NULL REFERENCES public.trials(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  scientific_role TEXT NOT NULL DEFAULT 'other'
    CHECK (scientific_role IN ('genotype', 'family', 'population', 'seed_lot', 'other')),
  parent_line_id UUID REFERENCES public.parent_lines(id) ON DELETE SET NULL,
  family_id UUID REFERENCES public.families(id) ON DELETE SET NULL,
  seed_lot_id UUID REFERENCES public.seed_lots(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  UNIQUE (trial_id, code)
);
COMMENT ON TABLE public.trial_entries IS
  'The experimental material compared across a trial''s environments. scientific_role is an explicit, user-stated classification (genotype/family/population/seed_lot/other) - never auto-derived from which optional lineage FK is set. Entry x Environment terminology in the UI follows this: only "genotype"-role entries may ever be labelled G x E, otherwise it is Entry x Environment.';

CREATE TRIGGER update_trial_entries_updated_at BEFORE UPDATE ON public.trial_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE FUNCTION public.validate_trial_entry_lineage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  trial_program UUID;
  lineage_program UUID;
BEGIN
  SELECT program_id INTO trial_program FROM trials WHERE id = NEW.trial_id AND deleted_at IS NULL;
  IF trial_program IS NULL THEN
    RAISE EXCEPTION 'Trial entry trial could not be resolved' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_line_id IS NOT NULL THEN
    SELECT program_id INTO lineage_program FROM parent_lines WHERE id = NEW.parent_line_id;
    IF lineage_program IS NULL OR lineage_program IS DISTINCT FROM trial_program THEN
      RAISE EXCEPTION 'parent_line_id must belong to the same program as the trial' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.family_id IS NOT NULL THEN
    SELECT program_id INTO lineage_program FROM families WHERE id = NEW.family_id;
    IF lineage_program IS NULL OR lineage_program IS DISTINCT FROM trial_program THEN
      RAISE EXCEPTION 'family_id must belong to the same program as the trial' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.seed_lot_id IS NOT NULL THEN
    SELECT program_id INTO lineage_program FROM seed_lots WHERE id = NEW.seed_lot_id;
    IF lineage_program IS NULL OR lineage_program IS DISTINCT FROM trial_program THEN
      RAISE EXCEPTION 'seed_lot_id must belong to the same program as the trial' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_trial_entry_lineage() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_trial_entry_lineage_trigger BEFORE INSERT OR UPDATE OF trial_id, parent_line_id, family_id, seed_lot_id ON public.trial_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_trial_entry_lineage();

ALTER TABLE public.trial_entries ENABLE ROW LEVEL SECURITY;
-- deleted_at intentionally not checked here either - same rationale as
-- sites_read above.
CREATE POLICY trial_entries_read ON public.trial_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM trials WHERE trials.id = trial_id AND can_access_program(trials.program_id)));
CREATE POLICY trial_entries_insert ON public.trial_entries FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_write_program(trials.program_id)));
CREATE POLICY trial_entries_update ON public.trial_entries FOR UPDATE
  USING (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_access_program(trials.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM trials WHERE trials.id = trial_id AND can_write_program(trials.program_id)));
REVOKE ALL ON public.trial_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trial_entries TO authenticated;

-- ───────────────────────── Linking phenotypes to MET entities ─────────────────────────
-- Additive nullable FKs only - every existing phenotype row keeps working
-- with both NULL, and raw phenotype/evaluation/trait-value data is never
-- rewritten by this migration or by any analysis built on top of it.
ALTER TABLE public.phenotypes ADD COLUMN environment_id UUID REFERENCES public.environments(id) ON DELETE SET NULL;
ALTER TABLE public.phenotypes ADD COLUMN trial_entry_id UUID REFERENCES public.trial_entries(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.phenotypes.environment_id IS
  'Optional link to the normalized MET environment this phenotype was observed in. NULL means not yet mapped - see the explicit mapping workflow; never inferred from the legacy free-text phenotypes.location.';
COMMENT ON COLUMN public.phenotypes.trial_entry_id IS
  'Optional link to the explicit trial entry (experimental material identity) this phenotype represents, for multi-environment comparison. NULL means not yet mapped to any trial.';

CREATE FUNCTION public.validate_phenotype_met_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  env_program UUID;
  entry_trial UUID;
  entry_program UUID;
BEGIN
  IF NEW.environment_id IS NOT NULL THEN
    SELECT program_id INTO env_program FROM environments WHERE id = NEW.environment_id AND deleted_at IS NULL;
    IF env_program IS NULL OR env_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'environment_id must belong to the same program as the phenotype' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.trial_entry_id IS NOT NULL THEN
    SELECT trial_id INTO entry_trial FROM trial_entries WHERE id = NEW.trial_entry_id AND deleted_at IS NULL;
    IF entry_trial IS NULL THEN
      RAISE EXCEPTION 'trial_entry_id could not be resolved' USING ERRCODE = '23514';
    END IF;
    SELECT program_id INTO entry_program FROM trials WHERE id = entry_trial;
    IF entry_program IS NULL OR entry_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'trial_entry_id must belong to a trial in the same program as the phenotype' USING ERRCODE = '23514';
    END IF;
    -- When both are set, the environment must actually be one of the
    -- entry's own trial's environments - otherwise a phenotype could claim
    -- an Entry x Environment combination its trial never defined.
    IF NEW.environment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trial_environments WHERE trial_id = entry_trial AND environment_id = NEW.environment_id
    ) THEN
      RAISE EXCEPTION 'environment_id must be one of trial_entry_id''s own trial environments' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_phenotype_met_links() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_phenotype_met_links_trigger BEFORE INSERT OR UPDATE OF environment_id, trial_entry_id, program_id ON public.phenotypes
  FOR EACH ROW EXECUTE FUNCTION public.validate_phenotype_met_links();

-- ───────────────────────── analytics_runs: multi_environment analysis type ─────────────────────────
ALTER TABLE public.analytics_runs DROP CONSTRAINT analytics_runs_analysis_type_check;
ALTER TABLE public.analytics_runs ADD CONSTRAINT analytics_runs_analysis_type_check
  CHECK (analysis_type IN ('trait_intelligence', 'multi_environment'));
ALTER TABLE public.analytics_runs ADD COLUMN trial_id UUID REFERENCES public.trials(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.analytics_runs.trial_id IS
  'The multi-environment trial this run analyzed. Required when analysis_type=multi_environment, NULL otherwise (see validate_analytics_run_scope).';

CREATE OR REPLACE FUNCTION public.validate_analytics_run_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resolved_org UUID;
  trait_org UUID;
  trial_program UUID;
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

  IF NEW.analysis_type = 'multi_environment' THEN
    IF NEW.trial_id IS NULL THEN
      RAISE EXCEPTION 'trial_id is required when analysis_type is multi_environment' USING ERRCODE = '23514';
    END IF;
    SELECT program_id INTO trial_program FROM trials WHERE id = NEW.trial_id AND deleted_at IS NULL;
    IF trial_program IS NULL OR trial_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'trial_id must belong to the same program as this run' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.trial_id IS NOT NULL THEN
    RAISE EXCEPTION 'trial_id must be NULL unless analysis_type is multi_environment' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ───────────────────────── Canonical MET observation dataset ─────────────────────────
-- Sibling of trait_observation_dataset (migration 000027): the ONE
-- server-side reader every V2-05 analysis is built from. SECURITY INVOKER,
-- every filter applied in the WHERE clause before the same N+1 row-cap
-- overflow-detection pattern (never a silently truncated prefix).
CREATE FUNCTION public.met_observation_dataset(
  target_trial_id UUID,
  target_trait_id UUID,
  include_archived BOOLEAN DEFAULT FALSE,
  row_limit INTEGER DEFAULT 5001
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
    AND EXISTS (
      SELECT 1 FROM phenotype_traits tr
      WHERE tr.id = target_trait_id AND tr.data_type IN ('numeric', 'integer', 'ordinal')
    )
    AND (include_archived OR (p.deleted_at IS NULL AND e.deleted_at IS NULL
      AND te.deleted_at IS NULL AND env.deleted_at IS NULL))
  ORDER BY env.code, e.evaluation_date NULLS LAST, tv.id
  LIMIT LEAST(COALESCE(row_limit, 5001), 5001);
$$;
REVOKE ALL ON FUNCTION public.met_observation_dataset(UUID, UUID, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.met_observation_dataset(UUID, UUID, BOOLEAN, INTEGER) TO authenticated;
COMMENT ON FUNCTION public.met_observation_dataset IS
  'The one server-side reader every V2-05 multi-environment analysis is built from. SECURITY INVOKER: caller''s own RLS on every joined table still applies; can_access_program() is an additional, redundant guard. LIMIT LEAST(row_limit, 5001) mirrors trait_observation_dataset''s N+1 overflow-detection pattern - never a silently truncated dataset.';
