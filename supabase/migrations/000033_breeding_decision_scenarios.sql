-- V2-06: Breeding decision & genetic gain analytics.
-- Additive only; 000001-000032 are left untouched.
--
-- Scope and design decisions (full rationale in docs/BREEDING_DECISION_ANALYTICS.md
-- and the BreedOps design rationale):
--  * Audited first (per task instruction): the existing operational scoring
--    system (`selection_models`/`selection_criteria`/`selection_decision_rules`,
--    `phenotype_evaluations.weighted_score`/`normalized_score`/
--    `automatic_decision`/`is_eliminated`, `refresh_phenotype_evaluation()`,
--    `set_program_trait_weight()`, the ranking UI in `/app/phenotypes`) is a
--    field/evaluation scoring WORKFLOW - one active model per program, a
--    fixed trait-weighted sum, eliminatory thresholds, a free-text decision
--    label. It is NOT replaced, NOT extended, and NOT touched by this
--    migration. V2-06 is a separate, explicitly-labelled analytical
--    decision-support layer the breeder can run ALONGSIDE it, never a
--    silent reinterpretation of its output as "genetic".
--  * `selection_models` is deliberately NOT reused for V2-06's scenario
--    configuration: its semantics (one maximum_score, one set of
--    coefficient/eliminatory-threshold criteria) are tied to the
--    operational scoring workflow and do not fit a multi-trait analytical
--    scenario (explicit direction/target per trait, named evidence
--    source, economic weights, a selection proportion). New tables
--    instead: `breeding_decision_scenarios` (configuration - mutable until
--    a run is made, like `selection_models`) and
--    `breeding_decision_scenario_traits` (its selected traits).
--  * Candidates are always `trial_entries` (V2-05), scoped to exactly one
--    trial per scenario - V2-06 never mixes phenotype/family/seed_lot/
--    trial_entry identities in one analysis (task review: "Do not mix in
--    one analysis... as interchangeable identities"). `candidate_type` is
--    a column (not hard-coded) so a future candidate entity can be added
--    without a schema rewrite, but only 'trial_entry' is allowed today.
--  * An analysis run reuses `analytics_runs` (new analysis_type
--    'breeding_decision'), never a parallel provenance table - same
--    convention V2-05 already established for 'multi_environment'.
--    `trait_id` becomes nullable (a breeding-decision run is inherently
--    multi-trait, so no single trait_id applies) and a new `scenario_id`
--    column is added, both enforced by the same
--    `validate_analytics_run_scope()` trigger, rewritten to add this
--    third case without weakening the first two's existing guarantees.
CREATE TABLE public.breeding_decision_scenarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  trial_id UUID NOT NULL REFERENCES public.trials(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  -- Fixed allowlist of one value today (trial_entry) - V2-05 already
  -- normalizes experimental material across environments, making it the
  -- one candidate identity V2-06 can compare without inventing a second,
  -- competing representation. A column, not a hard-coded assumption, so a
  -- future candidate entity can be added without a schema rewrite.
  candidate_type TEXT NOT NULL DEFAULT 'trial_entry'
    CHECK (candidate_type IN ('trial_entry')),
  -- Whether operationally-eliminated candidates (phenotype_evaluations.
  -- is_eliminated under the existing scoring workflow) are included or
  -- excluded from the analytical ranking - never silently excluded
  -- (task review §32): the choice is explicit, stored, and the excluded
  -- set + reason is always part of the run's own provenance.
  candidate_eligibility TEXT NOT NULL DEFAULT 'all'
    CHECK (candidate_eligibility IN ('all', 'exclude_operationally_eliminated')),
  -- Percentage of candidates retained - "selection proportion", never the
  -- standardized quantitative-genetics "selection intensity i" (task
  -- review §15: these are deliberately different, non-interchangeable
  -- terms; i is derived separately, in TypeScript, only where a genetic-
  -- response equation would need it, and labelled as such).
  selection_proportion NUMERIC NOT NULL
    CHECK (selection_proportion > 0 AND selection_proportion <= 100),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  UNIQUE (trial_id, name)
);
COMMENT ON TABLE public.breeding_decision_scenarios IS
  'A reusable, explicit breeder configuration for V2-06 multi-trait candidate ranking: one trial''s worth of trial_entries, a chosen selection proportion, and candidate eligibility policy. Mutable configuration, analogous to selection_models for the operational workflow - the immutable evidence is the analytics_runs row a run of this scenario produces, never this row itself.';
COMMENT ON COLUMN public.breeding_decision_scenarios.candidate_eligibility IS
  'all: every trial_entry candidate is considered. exclude_operationally_eliminated: candidates with is_eliminated=true on their most recent phenotype_evaluations row (the EXISTING operational scoring workflow) are excluded - always disclosed in the run''s provenance, never silent (task review §32).';

CREATE TRIGGER update_breeding_decision_scenarios_updated_at BEFORE UPDATE ON public.breeding_decision_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE FUNCTION public.validate_breeding_decision_scenario_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resolved_org UUID;
  trial_program UUID;
BEGIN
  SELECT organization_id INTO resolved_org FROM programs
  WHERE id = NEW.program_id AND deleted_at IS NULL;
  IF resolved_org IS NULL THEN
    RAISE EXCEPTION 'Breeding decision scenario program could not be resolved' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := resolved_org;

  SELECT program_id INTO trial_program FROM trials WHERE id = NEW.trial_id AND deleted_at IS NULL;
  IF trial_program IS NULL OR trial_program IS DISTINCT FROM NEW.program_id THEN
    RAISE EXCEPTION 'trial_id must belong to the same program as this scenario' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_breeding_decision_scenario_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_breeding_decision_scenario_scope_trigger
  BEFORE INSERT OR UPDATE OF program_id, trial_id ON public.breeding_decision_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.validate_breeding_decision_scenario_scope();

ALTER TABLE public.breeding_decision_scenarios ENABLE ROW LEVEL SECURITY;
-- deleted_at is NOT in this USING clause: lifecycle state, not an
-- authorization boundary - same established convention as sites_read/
-- trials_read (see 000028's own comment, tracing back to
-- 000022_business_completion.sql §E), so a plain archive UPDATE is never
-- rejected by PostgreSQL re-checking the SELECT policy post-UPDATE.
CREATE POLICY breeding_decision_scenarios_read ON public.breeding_decision_scenarios FOR SELECT
  USING (can_access_program(program_id));
CREATE POLICY breeding_decision_scenarios_insert ON public.breeding_decision_scenarios FOR INSERT
  WITH CHECK (can_write_program(program_id));
CREATE POLICY breeding_decision_scenarios_update ON public.breeding_decision_scenarios FOR UPDATE
  USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
REVOKE ALL ON public.breeding_decision_scenarios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.breeding_decision_scenarios TO authenticated;

-- ───────────────────────── Scenario traits ─────────────────────────
-- One row per trait selected into a scenario. source_type/source_run_id
-- together are the explicit provenance a breeding decision must make
-- visible (task review §8) - never an unlabelled "value", and never
-- called a genetic value merely because it came from a model.
CREATE TABLE public.breeding_decision_scenario_traits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES public.breeding_decision_scenarios(id) ON DELETE CASCADE,
  trait_id UUID NOT NULL REFERENCES public.phenotype_traits(id) ON DELETE CASCADE,
  -- Reuses phenotype_traits.direction's own vocabulary exactly (migration
  -- 000016) rather than inventing a second one - stored explicitly per
  -- scenario (not just read live from phenotype_traits at run time) so a
  -- scenario stays a self-contained, reproducible configuration even if
  -- the trait's own default direction is edited later. 'neutral' is
  -- deliberately not a valid choice here: every trait actually used in a
  -- ranking must have an explicit selection direction (task review §12 -
  -- never silently inferred from sign or name).
  direction TEXT NOT NULL
    CHECK (direction IN ('higher_is_better', 'lower_is_better', 'target_value')),
  target_value NUMERIC,
  -- Optional visible weight (task review §16) - never hidden from the
  -- breeder, always part of the stored specification.
  weight NUMERIC CHECK (weight IS NULL OR weight >= 0),
  -- Optional economic weight - required for Smith-Hazel eligibility
  -- (task review §20/§22), meaningless for MGIDI/MTSI.
  economic_weight NUMERIC,
  -- Where this trait's candidate x trait VALUE comes from - named
  -- precisely, never "genetic value" by default (task review §8).
  source_type TEXT NOT NULL CHECK (source_type IN (
    'RAW_PHENOTYPIC', 'PHENOTYPIC_MEAN', 'ADJUSTED_ENTRY_PREDICTION',
    'MET_ENTRY_PREDICTION', 'WAASBY_STABILITY_PERFORMANCE'
  )),
  -- The V2-05 analytics_runs row this trait's value was read from -
  -- required for ADJUSTED_ENTRY_PREDICTION/MET_ENTRY_PREDICTION/
  -- WAASBY_STABILITY_PERFORMANCE (a specific completed model run), NULL
  -- for RAW_PHENOTYPIC/PHENOTYPIC_MEAN (read directly from
  -- met_observation_dataset, same as V2-05's own canonical reader).
  source_run_id UUID REFERENCES public.analytics_runs(id) ON DELETE SET NULL,
  -- One explicit measurement occasion for RAW_PHENOTYPIC/PHENOTYPIC_MEAN,
  -- mirroring V2-05's own occasion filter (migration 000031) - never
  -- silently pools distinct dated evaluations of the same candidate.
  evaluation_date DATE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT breeding_decision_scenario_traits_target_value_consistency CHECK (
    (direction = 'target_value') = (target_value IS NOT NULL)
  ),
  CONSTRAINT breeding_decision_scenario_traits_source_run_required CHECK (
    (source_type IN ('RAW_PHENOTYPIC', 'PHENOTYPIC_MEAN')) OR (source_run_id IS NOT NULL)
  ),
  UNIQUE (scenario_id, trait_id)
);
COMMENT ON TABLE public.breeding_decision_scenario_traits IS
  'One selected trait within a breeding_decision_scenarios row: its explicit direction/target, optional weight(s), and exactly where its candidate x trait value comes from (source_type/source_run_id/evaluation_date) - the provenance task review §8 requires. Never averages or silently reinterprets a value''s evidence level.';

CREATE FUNCTION public.validate_breeding_decision_scenario_trait_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  scenario_org UUID;
  scenario_program UUID;
  trait_org UUID;
  run_program UUID;
BEGIN
  SELECT organization_id, program_id INTO scenario_org, scenario_program
  FROM breeding_decision_scenarios WHERE id = NEW.scenario_id;
  IF scenario_org IS NULL THEN
    RAISE EXCEPTION 'Scenario trait''s scenario could not be resolved' USING ERRCODE = '23514';
  END IF;

  SELECT organization_id INTO trait_org FROM phenotype_traits WHERE id = NEW.trait_id;
  IF trait_org IS NULL OR trait_org IS DISTINCT FROM scenario_org THEN
    RAISE EXCEPTION 'trait_id must belong to the same organization as the scenario' USING ERRCODE = '23514';
  END IF;

  -- Cross-program source-run injection is rejected here, independent of
  -- (in addition to) RLS - the same belt-and-suspenders discipline
  -- analytics_runs_insert itself already applies (task review §50).
  IF NEW.source_run_id IS NOT NULL THEN
    SELECT program_id INTO run_program FROM analytics_runs WHERE id = NEW.source_run_id;
    IF run_program IS NULL OR run_program IS DISTINCT FROM scenario_program THEN
      RAISE EXCEPTION 'source_run_id must belong to the same program as the scenario' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_breeding_decision_scenario_trait_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_breeding_decision_scenario_trait_scope_trigger
  BEFORE INSERT OR UPDATE ON public.breeding_decision_scenario_traits
  FOR EACH ROW EXECUTE FUNCTION public.validate_breeding_decision_scenario_trait_scope();

ALTER TABLE public.breeding_decision_scenario_traits ENABLE ROW LEVEL SECURITY;
CREATE POLICY breeding_decision_scenario_traits_read ON public.breeding_decision_scenario_traits FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM breeding_decision_scenarios s
    WHERE s.id = scenario_id AND can_access_program(s.program_id)
  ));
CREATE POLICY breeding_decision_scenario_traits_insert ON public.breeding_decision_scenario_traits FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM breeding_decision_scenarios s
    WHERE s.id = scenario_id AND can_write_program(s.program_id)
  ));
CREATE POLICY breeding_decision_scenario_traits_update ON public.breeding_decision_scenario_traits FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM breeding_decision_scenarios s
    WHERE s.id = scenario_id AND can_access_program(s.program_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM breeding_decision_scenarios s
    WHERE s.id = scenario_id AND can_write_program(s.program_id)
  ));
CREATE POLICY breeding_decision_scenario_traits_delete ON public.breeding_decision_scenario_traits FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM breeding_decision_scenarios s
    WHERE s.id = scenario_id AND can_write_program(s.program_id)
  ));
REVOKE ALL ON public.breeding_decision_scenario_traits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.breeding_decision_scenario_traits TO authenticated;

-- ───────────────────────── analytics_runs: breeding_decision analysis type ─────────────────────────
-- trait_id becomes nullable: a breeding-decision run is inherently
-- multi-trait (its traits live in breeding_decision_scenario_traits, via
-- scenario_id), so no single trait_id applies - unlike
-- 'trait_intelligence'/'multi_environment', which both still REQUIRE it,
-- enforced below exactly as before (this only adds a third case, it never
-- loosens the first two).
ALTER TABLE public.analytics_runs ALTER COLUMN trait_id DROP NOT NULL;
ALTER TABLE public.analytics_runs DROP CONSTRAINT analytics_runs_analysis_type_check;
ALTER TABLE public.analytics_runs ADD CONSTRAINT analytics_runs_analysis_type_check
  CHECK (analysis_type IN ('trait_intelligence', 'multi_environment', 'breeding_decision'));
ALTER TABLE public.analytics_runs ADD COLUMN scenario_id UUID REFERENCES public.breeding_decision_scenarios(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.analytics_runs.scenario_id IS
  'The breeding_decision_scenarios row this run evaluated. Required when analysis_type=breeding_decision, NULL otherwise (see validate_analytics_run_scope). trial_id is also required and must equal the scenario''s own trial_id - denormalized for the same query convenience multi_environment''s trial_id already provides.';

CREATE OR REPLACE FUNCTION public.validate_analytics_run_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resolved_org UUID;
  trait_org UUID;
  trial_program UUID;
  scenario_program UUID;
  scenario_trial UUID;
BEGIN
  SELECT organization_id INTO resolved_org FROM programs
  WHERE id = NEW.program_id AND deleted_at IS NULL;
  IF resolved_org IS NULL THEN
    RAISE EXCEPTION 'Analytics run program could not be resolved' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := resolved_org;

  IF NEW.trait_id IS NOT NULL THEN
    SELECT organization_id INTO trait_org FROM phenotype_traits WHERE id = NEW.trait_id;
    IF trait_org IS NULL OR trait_org IS DISTINCT FROM resolved_org THEN
      RAISE EXCEPTION 'trait_id must belong to the same organization as the program' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.analysis_type != 'breeding_decision' THEN
    RAISE EXCEPTION 'trait_id is required unless analysis_type is breeding_decision' USING ERRCODE = '23514';
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
    IF NEW.scenario_id IS NOT NULL THEN
      RAISE EXCEPTION 'scenario_id must be NULL unless analysis_type is breeding_decision' USING ERRCODE = '23514';
    END IF;
    SELECT program_id INTO trial_program FROM trials WHERE id = NEW.trial_id AND deleted_at IS NULL;
    IF trial_program IS NULL OR trial_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'trial_id must belong to the same program as this run' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.analysis_type = 'breeding_decision' THEN
    IF NEW.scenario_id IS NULL THEN
      RAISE EXCEPTION 'scenario_id is required when analysis_type is breeding_decision' USING ERRCODE = '23514';
    END IF;
    SELECT program_id, trial_id INTO scenario_program, scenario_trial
    FROM breeding_decision_scenarios WHERE id = NEW.scenario_id;
    IF scenario_program IS NULL OR scenario_program IS DISTINCT FROM NEW.program_id THEN
      RAISE EXCEPTION 'scenario_id must belong to the same program as this run' USING ERRCODE = '23514';
    END IF;
    IF NEW.trial_id IS NULL OR NEW.trial_id IS DISTINCT FROM scenario_trial THEN
      RAISE EXCEPTION 'trial_id must equal the scenario''s own trial_id' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.trial_id IS NOT NULL THEN
      RAISE EXCEPTION 'trial_id must be NULL unless analysis_type is multi_environment or breeding_decision' USING ERRCODE = '23514';
    END IF;
    IF NEW.scenario_id IS NOT NULL THEN
      RAISE EXCEPTION 'scenario_id must be NULL unless analysis_type is breeding_decision' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ───────────────────────── Candidate pool reader ─────────────────────────
-- The one server-side reader every V2-06 candidate-matrix build starts
-- from, mirroring met_observation_dataset's role for V2-05: SECURITY
-- INVOKER, so the caller's own RLS on every joined table still applies.
-- operationally_eliminated reflects the EXISTING scoring workflow's own
-- is_eliminated flag (phenotype_evaluations, migration 000022) on each
-- linked phenotype's most recent evaluation - never silently excluded
-- from the candidate pool here (task review §32): this function always
-- returns every trial_entry; it is purely a per-candidate diagnostic flag
-- a scenario's own candidate_eligibility setting then decides whether to
-- act on, in TypeScript, with the exclusion and its reason disclosed in
-- the run's own provenance.
CREATE FUNCTION public.breeding_candidate_pool(target_trial_id UUID)
RETURNS TABLE (
  trial_entry_id UUID,
  code TEXT,
  label TEXT,
  scientific_role TEXT,
  operationally_eliminated BOOLEAN
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    te.id, te.code, te.label, te.scientific_role,
    COALESCE(bool_or(COALESCE(latest_eval.is_eliminated, FALSE)), FALSE)
  FROM trial_entries te
  JOIN trials t ON t.id = te.trial_id
  LEFT JOIN phenotypes p ON p.trial_entry_id = te.id AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT e.is_eliminated
    FROM phenotype_evaluations e
    WHERE e.phenotype_id = p.id
    ORDER BY e.evaluation_date DESC NULLS LAST, e.created_at DESC
    LIMIT 1
  ) latest_eval ON p.id IS NOT NULL
  WHERE te.trial_id = target_trial_id
    AND te.deleted_at IS NULL
    AND can_access_program(t.program_id)
  GROUP BY te.id, te.code, te.label, te.scientific_role;
$$;
REVOKE ALL ON FUNCTION public.breeding_candidate_pool(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.breeding_candidate_pool(UUID) TO authenticated;
COMMENT ON FUNCTION public.breeding_candidate_pool IS
  'Every trial_entry candidate for a trial, with operationally_eliminated reflecting the EXISTING scoring workflow''s is_eliminated flag on each linked phenotype''s most recent evaluation. Always returns every entry - exclusion by candidate_eligibility is a TypeScript-side, disclosed decision, never silent (task review §32).';
