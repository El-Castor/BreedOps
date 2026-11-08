-- V2-05 scientific hardening (independent review finding #5, import
-- integrity): import_met_observations() (migration 000030) resolved the
-- evaluation event to update via
--   SELECT id FROM phenotype_evaluations WHERE phenotype_id = ... ORDER BY created_at LIMIT 1
-- which ignores the incoming evaluation_date entirely. If a phenotype
-- already has more than one dated evaluation event (exactly the
-- longitudinal case migration 000031/src/lib/met/eligibility.ts's
-- occasion-ambiguity gate now has to account for), a re-import with a
-- NEW evaluation_date would silently overwrite the OLDEST evaluation's
-- value instead of creating or updating the one for the date actually
-- being imported - a different, wrong measurement occasion, written over
-- without any error.
--
-- Fix: resolve the evaluation event by (phenotype_id, evaluation_date) -
-- an exact match on that date is updated, no match creates a new dated
-- evaluation event (never reusing an unrelated one). evaluation_date
-- becomes a required column for MET import specifically (it already was
-- for every other row-level identity field: phenotype_code/entry_code/
-- environment_code) - this is what makes the resolution key unambiguous;
-- the bulk-generic phenotype import (import_phenotypes, 000021) and the
-- phenotype_evaluations.evaluation_date column itself are both untouched
-- and stay nullable.
--
-- CREATE OR REPLACE is correct here (unlike migration 000031's
-- met_observation_dataset change): the parameter list is unchanged, only
-- the function body's internal resolution logic changes.
CREATE OR REPLACE FUNCTION public.import_met_observations(
  target_program_id UUID,
  target_trial_id UUID,
  target_trait_id UUID,
  rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_organization_id UUID;
  v_trial_program UUID;
  v_trait_org UUID;
  v_trait_data_type TEXT;
  v_code TEXT;
  v_entry_code TEXT;
  v_environment_code TEXT;
  v_entry_id UUID;
  v_environment_id UUID;
  v_value NUMERIC;
  v_block TEXT;
  v_evaluation_date DATE;
  v_existing_phenotype_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_entry UUID;
  v_existing_environment UUID;
  v_evaluation_id UUID;
  v_new_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id AND deleted_at IS NULL;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Program could not be resolved' USING ERRCODE = '23514';
  END IF;

  SELECT program_id INTO v_trial_program FROM trials WHERE id = target_trial_id AND deleted_at IS NULL;
  IF v_trial_program IS NULL OR v_trial_program IS DISTINCT FROM target_program_id THEN
    RAISE EXCEPTION 'trial_id must belong to this program' USING ERRCODE = '23514';
  END IF;

  SELECT organization_id, data_type INTO v_trait_org, v_trait_data_type FROM phenotype_traits WHERE id = target_trait_id;
  IF v_trait_org IS NULL OR v_trait_org IS DISTINCT FROM v_organization_id THEN
    RAISE EXCEPTION 'trait_id must belong to this organization' USING ERRCODE = '23514';
  END IF;
  IF v_trait_data_type NOT IN ('numeric', 'integer', 'ordinal') THEN
    RAISE EXCEPTION 'MET import only supports numeric/integer/ordinal traits' USING ERRCODE = '23514';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'phenotype_code'), '');
    v_entry_code := NULLIF(BTRIM(v_row->>'entry_code'), '');
    v_environment_code := NULLIF(BTRIM(v_row->>'environment_code'), '');
    v_block := NULLIF(BTRIM(v_row->>'block'), '');
    IF v_code IS NULL OR v_entry_code IS NULL OR v_environment_code IS NULL THEN
      RAISE EXCEPTION 'Row %: phenotype_code, entry_code and environment_code are all required', v_row->'row_index' USING ERRCODE = '23502';
    END IF;

    BEGIN
      v_value := (v_row->>'value')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Row %: value is not a valid number', v_row->'row_index' USING ERRCODE = '22023';
    END;

    BEGIN
      v_evaluation_date := NULLIF(BTRIM(v_row->>'evaluation_date'), '')::DATE;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Row %: evaluation_date is not a valid date', v_row->'row_index' USING ERRCODE = '22023';
    END;
    -- Required (B-review finding #5): the evaluation event to update or
    -- create is resolved by (phenotype_id, evaluation_date) below - an
    -- unset date would make that resolution ambiguous (which existing
    -- evaluation, if any, is "the" one for this row?), the exact defect
    -- this migration fixes.
    IF v_evaluation_date IS NULL THEN
      RAISE EXCEPTION 'Row %: evaluation_date is required', v_row->'row_index' USING ERRCODE = '23502';
    END IF;

    -- Entry/environment identity is never created by import (see header
    -- comment) - both must already exist, and the environment must
    -- already be one of this trial's own trial_environments.
    SELECT id INTO v_entry_id FROM trial_entries
    WHERE trial_id = target_trial_id AND code = v_entry_code AND deleted_at IS NULL;
    IF v_entry_id IS NULL THEN
      RAISE EXCEPTION 'Row %: entry_code % not found in this trial', v_row->'row_index', v_entry_code USING ERRCODE = '23503';
    END IF;

    SELECT e.id INTO v_environment_id FROM environments e
    JOIN trial_environments te ON te.environment_id = e.id AND te.trial_id = target_trial_id
    WHERE e.program_id = target_program_id AND e.code = v_environment_code AND e.deleted_at IS NULL;
    IF v_environment_id IS NULL THEN
      RAISE EXCEPTION 'Row %: environment_code % not found among this trial''s own environments', v_row->'row_index', v_environment_code USING ERRCODE = '23503';
    END IF;

    SELECT id, deleted_at, trial_entry_id, environment_id INTO v_existing_phenotype_id, v_existing_deleted, v_existing_entry, v_existing_environment
    FROM phenotypes WHERE program_id = target_program_id AND phenotype_code = v_code;

    IF v_existing_phenotype_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: phenotype % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      -- entry_id/environment_id are identity fields for a MET observation,
      -- same immutability rule import_phenotypes already applies to
      -- family/seed lot: re-importing the same phenotype_code updates its
      -- value, never silently moves it to a different entry/environment.
      IF v_existing_entry IS DISTINCT FROM v_entry_id OR v_existing_environment IS DISTINCT FROM v_environment_id THEN
        RAISE EXCEPTION 'Row %: entry/environment are immutable identity fields and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
      END IF;
      -- Resolve the evaluation EVENT by (phenotype_id, evaluation_date) -
      -- never "the first one by created_at" (the bug this migration
      -- fixes). An exact match on this date is the evaluation to update;
      -- no match means this date is a new measurement occasion for this
      -- phenotype, so a new evaluation event is created rather than
      -- reusing an unrelated one.
      SELECT id INTO v_evaluation_id FROM phenotype_evaluations
      WHERE phenotype_id = v_existing_phenotype_id AND evaluation_date = v_evaluation_date;
      IF v_evaluation_id IS NULL THEN
        INSERT INTO phenotype_evaluations (phenotype_id, evaluation_date) VALUES (v_existing_phenotype_id, v_evaluation_date) RETURNING id INTO v_evaluation_id;
      END IF;
      INSERT INTO phenotype_trait_values (phenotype_evaluation_id, trait_id, numeric_value)
      VALUES (v_evaluation_id, target_trait_id, v_value)
      ON CONFLICT (phenotype_evaluation_id, trait_id) DO UPDATE SET numeric_value = EXCLUDED.numeric_value;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_phenotype_id, 'code', v_code);
      v_updated_count := v_updated_count + 1;
    ELSE
      INSERT INTO phenotypes (program_id, trial_entry_id, environment_id, phenotype_code, block)
      VALUES (target_program_id, v_entry_id, v_environment_id, v_code, v_block)
      RETURNING id INTO v_new_id;
      INSERT INTO phenotype_evaluations (phenotype_id, evaluation_date) VALUES (v_new_id, v_evaluation_date) RETURNING id INTO v_evaluation_id;
      INSERT INTO phenotype_trait_values (phenotype_evaluation_id, trait_id, numeric_value) VALUES (v_evaluation_id, target_trait_id, v_value);
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'met_observations',
    jsonb_build_object('trial_id', target_trial_id, 'trait_id', target_trait_id, 'created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
  RETURN v_results;
END;
$$;
COMMENT ON FUNCTION public.import_met_observations IS
  'Bulk-imports MET observations (numeric trait values) into an already-defined trial. Never creates a trial_entry or environment from a CSV column - both must already exist (B41/{"/app/trials"}). Idempotent on phenotype_code: an existing one is updated (value only, entry/environment are immutable identity fields), a new one is created. evaluation_date is required (000032) and resolves WHICH evaluation event to update/create via (phenotype_id, evaluation_date) - never "the first evaluation by created_at" - so a phenotype with several dated evaluations is never silently overwritten on the wrong occasion. Aborts the whole call (never half-applied) on any row that fails an invariant.';
