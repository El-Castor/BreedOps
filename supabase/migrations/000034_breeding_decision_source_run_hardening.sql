-- V2-06 hardening (independent review, PR #15): a scenario trait's
-- source_run_id was only checked against the scenario's own PROGRAM
-- (migration 000033). It was never checked against the scenario trait's
-- own TRIAL or TRAIT, nor against the source run's own analysis_type.
-- This allowed a scenario trait for trait A to be configured with a
-- source_run_id that was actually a completed multi_environment run for
-- trait B (or for a different trial in the same program) - BreedOps would
-- then read B's BLUP/WAASBY values and present them as A's evidence.
--
-- This migration is additive only: 000001-000033 are left untouched, per
-- "never modify a historical migration".
CREATE OR REPLACE FUNCTION public.validate_breeding_decision_scenario_trait_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  scenario_org UUID;
  scenario_program UUID;
  scenario_trial UUID;
  trait_org UUID;
  run_program UUID;
  run_trial UUID;
  run_trait UUID;
  run_analysis_type TEXT;
BEGIN
  SELECT organization_id, program_id, trial_id INTO scenario_org, scenario_program, scenario_trial
  FROM breeding_decision_scenarios WHERE id = NEW.scenario_id;
  IF scenario_org IS NULL THEN
    RAISE EXCEPTION 'Scenario trait''s scenario could not be resolved' USING ERRCODE = '23514';
  END IF;

  SELECT organization_id INTO trait_org FROM phenotype_traits WHERE id = NEW.trait_id;
  IF trait_org IS NULL OR trait_org IS DISTINCT FROM scenario_org THEN
    RAISE EXCEPTION 'trait_id must belong to the same organization as the scenario' USING ERRCODE = '23514';
  END IF;

  -- source_run_id must belong to the same program AND trial AND exact
  -- trait as this scenario trait, and must itself be a multi_environment
  -- run - independent of (in addition to) RLS and of whatever the
  -- application layer separately re-validates (task review hardening #1:
  -- belt-and-suspenders, never relying on the UI alone). Staleness
  -- (whether the source run's own dataset_fingerprint still matches its
  -- underlying observations) and measurement-occasion compatibility are
  -- NOT checked here - both require recomputing a live dataset, which is
  -- exactly the kind of work SECURITY DEFINER triggers should not do;
  -- those are the application layer's job (src/lib/breeding-decision/
  -- dataset.ts's loadAndValidateMetSourceRun()).
  IF NEW.source_run_id IS NOT NULL THEN
    SELECT program_id, trial_id, trait_id, analysis_type
      INTO run_program, run_trial, run_trait, run_analysis_type
    FROM analytics_runs WHERE id = NEW.source_run_id;
    IF run_program IS NULL OR run_program IS DISTINCT FROM scenario_program THEN
      RAISE EXCEPTION 'source_run_id must belong to the same program as the scenario' USING ERRCODE = '23514';
    END IF;
    IF run_analysis_type IS DISTINCT FROM 'multi_environment' THEN
      RAISE EXCEPTION 'source_run_id must be a multi_environment analytics run' USING ERRCODE = '23514';
    END IF;
    IF run_trial IS DISTINCT FROM scenario_trial THEN
      RAISE EXCEPTION 'source_run_id must belong to the same trial as the scenario' USING ERRCODE = '23514';
    END IF;
    IF run_trait IS DISTINCT FROM NEW.trait_id THEN
      RAISE EXCEPTION 'source_run_id must have been computed for this exact trait, not a different trait in the same trial' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
