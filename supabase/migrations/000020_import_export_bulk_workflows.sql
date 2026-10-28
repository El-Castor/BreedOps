-- Import/Export Bulk Workflows: a durable business identifier for tasks (PROMPT.md §12
-- lists "Task ID" alongside Parent/Cross/Family/Seed Lot/Phenotype ID as a required
-- idempotency key, but no such column existed) and one transactional import-apply RPC
-- per importable entity. Each RPC re-derives create-vs-update itself from the business
-- code rather than trusting a client-supplied decision, and aborts its whole call (a
-- plain Postgres transaction) on any row that fails an invariant, so a batch can never
-- leave an ambiguous half-imported state. Preview/validation happens read-only in the
-- application layer before any of these are called; the client sends only rows it
-- believes are CREATE or UPDATE, and these functions independently re-verify that.
--
-- Every local scalar variable below is prefixed `v_` specifically so it can never be
-- mistaken for one of the table columns of the same business name (e.g. `cross_code`,
-- `cross_id`) inside the same function body — PL/pgSQL does not reliably disambiguate
-- an unprefixed local variable from a column of that exact name referenced in a nested
-- SQL statement, and silently picking the wrong one is worse than a naming convention.

ALTER TABLE public.tasks ADD COLUMN task_code TEXT UNIQUE;

ALTER TABLE public.breeding_code_counters DROP CONSTRAINT breeding_code_counters_entity_type_check;
ALTER TABLE public.breeding_code_counters ADD CONSTRAINT breeding_code_counters_entity_type_check
  CHECK (entity_type IN ('parent', 'cross', 'family', 'seed_lot', 'phenotype', 'task'));

CREATE OR REPLACE FUNCTION public.next_breeding_business_code(
  target_program_id UUID,
  target_entity_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program_prefix TEXT;
  v_type_prefix TEXT;
  v_existing_max BIGINT;
  v_next_value BIGINT;
  v_candidate TEXT;
  v_candidate_exists BOOLEAN;
BEGIN
  IF target_entity_type NOT IN ('parent', 'cross', 'family', 'seed_lot', 'phenotype', 'task') THEN
    RAISE EXCEPTION 'Unsupported breeding entity type';
  END IF;

  SELECT UPPER(REGEXP_REPLACE(code, '[^A-Za-z0-9]+', '', 'g'))
  INTO v_program_prefix
  FROM public.programs
  WHERE id = target_program_id AND deleted_at IS NULL;

  IF v_program_prefix IS NULL OR v_program_prefix = '' THEN
    RAISE EXCEPTION 'An active program with a usable code is required';
  END IF;

  v_type_prefix := CASE target_entity_type
    WHEN 'parent' THEN 'P'
    WHEN 'cross' THEN 'X'
    WHEN 'family' THEN 'F'
    WHEN 'seed_lot' THEN 'L'
    WHEN 'phenotype' THEN 'I'
    WHEN 'task' THEN 'T'
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_program_id::TEXT || ':' || target_entity_type, 0)
  );

  EXECUTE CASE target_entity_type
    WHEN 'parent' THEN
      'SELECT COALESCE(MAX((SUBSTRING(parent_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.parent_lines WHERE program_id = $1 AND parent_code ~ $2'
    WHEN 'cross' THEN
      'SELECT COALESCE(MAX((SUBSTRING(cross_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.crosses WHERE program_id = $1 AND cross_code ~ $2'
    WHEN 'family' THEN
      'SELECT COALESCE(MAX((SUBSTRING(family_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.families WHERE program_id = $1 AND family_code ~ $2'
    WHEN 'seed_lot' THEN
      'SELECT COALESCE(MAX((SUBSTRING(seed_lot_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.seed_lots WHERE program_id = $1 AND seed_lot_code ~ $2'
    WHEN 'phenotype' THEN
      'SELECT COALESCE(MAX((SUBSTRING(phenotype_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.phenotypes WHERE program_id = $1 AND phenotype_code ~ $2'
    WHEN 'task' THEN
      'SELECT COALESCE(MAX((SUBSTRING(task_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.tasks WHERE program_id = $1 AND task_code ~ $2'
  END
  INTO v_existing_max
  USING target_program_id, '^' || v_program_prefix || '-' || v_type_prefix || '-[0-9]+$';

  INSERT INTO public.breeding_code_counters (program_id, entity_type, last_value)
  VALUES (target_program_id, target_entity_type, v_existing_max + 1)
  ON CONFLICT (program_id, entity_type) DO UPDATE
  SET last_value = GREATEST(
        public.breeding_code_counters.last_value + 1,
        EXCLUDED.last_value
      ),
      updated_at = NOW()
  RETURNING last_value INTO v_next_value;

  LOOP
    v_candidate := v_program_prefix || '-' || v_type_prefix || '-' || LPAD(v_next_value::TEXT, 4, '0');

    EXECUTE CASE target_entity_type
      WHEN 'parent' THEN 'SELECT EXISTS (SELECT 1 FROM public.parent_lines WHERE parent_code = $1)'
      WHEN 'cross' THEN 'SELECT EXISTS (SELECT 1 FROM public.crosses WHERE cross_code = $1)'
      WHEN 'family' THEN 'SELECT EXISTS (SELECT 1 FROM public.families WHERE family_code = $1)'
      WHEN 'seed_lot' THEN 'SELECT EXISTS (SELECT 1 FROM public.seed_lots WHERE seed_lot_code = $1)'
      WHEN 'phenotype' THEN 'SELECT EXISTS (SELECT 1 FROM public.phenotypes WHERE phenotype_code = $1)'
      WHEN 'task' THEN 'SELECT EXISTS (SELECT 1 FROM public.tasks WHERE task_code = $1)'
    END
    INTO v_candidate_exists
    USING v_candidate;

    EXIT WHEN NOT v_candidate_exists;

    UPDATE public.breeding_code_counters
    SET last_value = last_value + 1, updated_at = NOW()
    WHERE program_id = target_program_id AND entity_type = target_entity_type
    RETURNING last_value INTO v_next_value;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- Manually created tasks never had a code; template-generated ones still won't unless
-- imported/edited to have one (task_code stays NULL by default, unlike the breeding
-- entities, since most tasks are generated at high volume by instantiate_experimental_cycle
-- and do not need one). Import is the only path that assigns task_code.

-- ===========================================================================
-- Shared row-result shape for every import_* function below:
--   jsonb array of {"row_index": int, "status": "created"|"updated", "id": uuid, "code": text}
-- Any row that fails an invariant raises, rolling back the whole call.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.import_parent_lines(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_new_id UUID;
  v_code TEXT;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'parent_code'), '');
    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at INTO v_existing_id, v_existing_deleted
      FROM parent_lines WHERE program_id = target_program_id AND parent_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: parent % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      UPDATE parent_lines SET
        line_name = COALESCE(NULLIF(BTRIM(v_row->>'line_name'), ''), line_name),
        generation = COALESCE((v_row->>'generation')::INTEGER, generation),
        origin = COALESCE(NULLIF(BTRIM(v_row->>'origin'), ''), origin),
        accession = COALESCE(NULLIF(BTRIM(v_row->>'accession'), ''), accession),
        source = COALESCE(NULLIF(BTRIM(v_row->>'source'), ''), source),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      INSERT INTO parent_lines (program_id, parent_code, line_name, generation, origin, accession, source, notes)
      VALUES (
        target_program_id, v_code,
        NULLIF(BTRIM(v_row->>'line_name'), ''),
        (v_row->>'generation')::INTEGER,
        NULLIF(BTRIM(v_row->>'origin'), ''),
        NULLIF(BTRIM(v_row->>'accession'), ''),
        NULLIF(BTRIM(v_row->>'source'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id, parent_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_parent_lines(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_parent_lines(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_crosses(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_female UUID;
  v_existing_male UUID;
  v_new_id UUID;
  v_code TEXT;
  v_female_id UUID;
  v_male_id UUID;
  v_female_code TEXT;
  v_male_code TEXT;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'cross_code'), '');
    v_female_code := NULLIF(BTRIM(v_row->>'female_parent_code'), '');
    v_male_code := NULLIF(BTRIM(v_row->>'male_parent_code'), '');
    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at, female_parent_id, male_parent_id
      INTO v_existing_id, v_existing_deleted, v_existing_female, v_existing_male
      FROM crosses WHERE program_id = target_program_id AND cross_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: cross % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      IF v_female_code IS NOT NULL THEN
        SELECT id INTO v_female_id FROM parent_lines WHERE program_id = target_program_id AND parent_code = v_female_code AND deleted_at IS NULL;
        IF v_female_id IS NULL OR v_female_id <> v_existing_female THEN
          RAISE EXCEPTION 'Row %: female parent is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF v_male_code IS NOT NULL THEN
        SELECT id INTO v_male_id FROM parent_lines WHERE program_id = target_program_id AND parent_code = v_male_code AND deleted_at IS NULL;
        IF v_male_id IS NULL OR v_male_id <> v_existing_male THEN
          RAISE EXCEPTION 'Row %: male parent is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
        END IF;
      END IF;
      UPDATE crosses SET
        generation = COALESCE((v_row->>'generation')::INTEGER, generation),
        target_traits = COALESCE(NULLIF(BTRIM(v_row->>'target_traits'), ''), target_traits),
        pollination_date = COALESCE((v_row->>'pollination_date')::DATE, pollination_date),
        harvest_date = COALESCE((v_row->>'harvest_date')::DATE, harvest_date),
        pollinated_units = COALESCE((v_row->>'pollinated_units')::INTEGER, pollinated_units),
        established_units = COALESCE((v_row->>'established_units')::INTEGER, established_units),
        total_seeds = COALESCE((v_row->>'total_seeds')::INTEGER, total_seeds),
        priority = COALESCE(NULLIF(BTRIM(v_row->>'priority'), ''), priority),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      IF v_female_code IS NULL OR v_male_code IS NULL THEN
        RAISE EXCEPTION 'Row %: both parent codes are required to create a cross', v_row->'row_index' USING ERRCODE = '23502';
      END IF;
      SELECT id INTO v_female_id FROM parent_lines WHERE program_id = target_program_id AND parent_code = v_female_code AND deleted_at IS NULL;
      SELECT id INTO v_male_id FROM parent_lines WHERE program_id = target_program_id AND parent_code = v_male_code AND deleted_at IS NULL;
      IF v_female_id IS NULL THEN
        RAISE EXCEPTION 'Row %: female parent code % not found in this program', v_row->'row_index', v_female_code USING ERRCODE = '23503';
      END IF;
      IF v_male_id IS NULL THEN
        RAISE EXCEPTION 'Row %: male parent code % not found in this program', v_row->'row_index', v_male_code USING ERRCODE = '23503';
      END IF;
      INSERT INTO crosses (
        program_id, cross_code, female_parent_id, male_parent_id, generation, target_traits,
        pollination_date, harvest_date, pollinated_units, established_units, total_seeds, priority, notes
      ) VALUES (
        target_program_id, v_code, v_female_id, v_male_id,
        (v_row->>'generation')::INTEGER,
        NULLIF(BTRIM(v_row->>'target_traits'), ''),
        (v_row->>'pollination_date')::DATE,
        (v_row->>'harvest_date')::DATE,
        (v_row->>'pollinated_units')::INTEGER,
        (v_row->>'established_units')::INTEGER,
        (v_row->>'total_seeds')::INTEGER,
        NULLIF(BTRIM(v_row->>'priority'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id, cross_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_crosses(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_crosses(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_families(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_cross UUID;
  v_new_id UUID;
  v_code TEXT;
  v_cross_code TEXT;
  v_cross_id UUID;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'family_code'), '');
    v_cross_code := NULLIF(BTRIM(v_row->>'cross_code'), '');
    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at, cross_id INTO v_existing_id, v_existing_deleted, v_existing_cross
      FROM families WHERE program_id = target_program_id AND family_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: family % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      IF v_cross_code IS NOT NULL THEN
        SELECT id INTO v_cross_id FROM crosses WHERE program_id = target_program_id AND cross_code = v_cross_code AND deleted_at IS NULL;
        IF v_cross_id IS NULL OR v_cross_id <> v_existing_cross THEN
          RAISE EXCEPTION 'Row %: cross is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
        END IF;
      END IF;
      UPDATE families SET
        generation = COALESCE((v_row->>'generation')::INTEGER, generation),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      IF v_cross_code IS NULL THEN
        RAISE EXCEPTION 'Row %: a cross code is required to create a family', v_row->'row_index' USING ERRCODE = '23502';
      END IF;
      SELECT id INTO v_cross_id FROM crosses WHERE program_id = target_program_id AND cross_code = v_cross_code AND deleted_at IS NULL;
      IF v_cross_id IS NULL THEN
        RAISE EXCEPTION 'Row %: cross code % not found in this program', v_row->'row_index', v_cross_code USING ERRCODE = '23503';
      END IF;
      INSERT INTO families (program_id, cross_id, family_code, generation, notes)
      VALUES (target_program_id, v_cross_id, v_code, (v_row->>'generation')::INTEGER, NULLIF(BTRIM(v_row->>'notes'), ''))
      RETURNING id, family_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_families(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_families(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_seed_lots(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_cross UUID;
  v_existing_family UUID;
  v_new_id UUID;
  v_code TEXT;
  v_cross_code TEXT;
  v_family_code TEXT;
  v_cross_id UUID;
  v_family_id UUID;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'seed_lot_code'), '');
    v_cross_code := NULLIF(BTRIM(v_row->>'cross_code'), '');
    v_family_code := NULLIF(BTRIM(v_row->>'family_code'), '');
    v_cross_id := NULL;
    v_family_id := NULL;
    IF v_cross_code IS NOT NULL THEN
      SELECT id INTO v_cross_id FROM crosses WHERE program_id = target_program_id AND cross_code = v_cross_code AND deleted_at IS NULL;
      IF v_cross_id IS NULL THEN
        RAISE EXCEPTION 'Row %: cross code % not found in this program', v_row->'row_index', v_cross_code USING ERRCODE = '23503';
      END IF;
    END IF;
    IF v_family_code IS NOT NULL THEN
      SELECT id INTO v_family_id FROM families WHERE program_id = target_program_id AND family_code = v_family_code AND deleted_at IS NULL;
      IF v_family_id IS NULL THEN
        RAISE EXCEPTION 'Row %: family code % not found in this program', v_row->'row_index', v_family_code USING ERRCODE = '23503';
      END IF;
    END IF;

    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at, cross_id, family_id INTO v_existing_id, v_existing_deleted, v_existing_cross, v_existing_family
      FROM seed_lots WHERE program_id = target_program_id AND seed_lot_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: seed lot % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      IF (v_cross_code IS NOT NULL AND v_cross_id <> v_existing_cross) OR (v_family_code IS NOT NULL AND v_family_id <> v_existing_family) THEN
        RAISE EXCEPTION 'Row %: cross/family lineage is immutable and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
      END IF;
      UPDATE seed_lots SET
        harvest_date = COALESCE((v_row->>'harvest_date')::DATE, harvest_date),
        total_quantity = COALESCE((v_row->>'total_quantity')::NUMERIC, total_quantity),
        quantity_unit = COALESCE(NULLIF(BTRIM(v_row->>'quantity_unit'), ''), quantity_unit),
        storage_location = COALESCE(NULLIF(BTRIM(v_row->>'storage_location'), ''), storage_location),
        genetic_purity_status = COALESCE(NULLIF(BTRIM(v_row->>'genetic_purity_status'), ''), genetic_purity_status),
        verification_method = COALESCE(NULLIF(BTRIM(v_row->>'verification_method'), ''), verification_method),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      INSERT INTO seed_lots (
        program_id, cross_id, family_id, seed_lot_code, harvest_date, total_quantity,
        quantity_unit, storage_location, genetic_purity_status, verification_method, notes
      ) VALUES (
        target_program_id, v_cross_id, v_family_id, v_code,
        (v_row->>'harvest_date')::DATE,
        (v_row->>'total_quantity')::NUMERIC,
        NULLIF(BTRIM(v_row->>'quantity_unit'), ''),
        NULLIF(BTRIM(v_row->>'storage_location'), ''),
        NULLIF(BTRIM(v_row->>'genetic_purity_status'), ''),
        NULLIF(BTRIM(v_row->>'verification_method'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id, seed_lot_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_seed_lots(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_seed_lots(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_phenotypes(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_family UUID;
  v_existing_seed_lot UUID;
  v_new_id UUID;
  v_code TEXT;
  v_family_code TEXT;
  v_seed_lot_code TEXT;
  v_family_id UUID;
  v_seed_lot_id UUID;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'phenotype_code'), '');
    v_family_code := NULLIF(BTRIM(v_row->>'family_code'), '');
    v_seed_lot_code := NULLIF(BTRIM(v_row->>'seed_lot_code'), '');
    v_seed_lot_id := NULL;
    IF v_seed_lot_code IS NOT NULL THEN
      SELECT id INTO v_seed_lot_id FROM seed_lots WHERE program_id = target_program_id AND seed_lot_code = v_seed_lot_code AND deleted_at IS NULL;
      IF v_seed_lot_id IS NULL THEN
        RAISE EXCEPTION 'Row %: seed lot code % not found in this program', v_row->'row_index', v_seed_lot_code USING ERRCODE = '23503';
      END IF;
    END IF;

    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at, family_id, seed_lot_id INTO v_existing_id, v_existing_deleted, v_existing_family, v_existing_seed_lot
      FROM phenotypes WHERE program_id = target_program_id AND phenotype_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: phenotype % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      IF v_family_code IS NOT NULL THEN
        SELECT id INTO v_family_id FROM families WHERE program_id = target_program_id AND family_code = v_family_code AND deleted_at IS NULL;
        IF v_family_id IS NULL OR v_family_id <> v_existing_family THEN
          RAISE EXCEPTION 'Row %: family is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF v_seed_lot_code IS NOT NULL AND v_seed_lot_id <> v_existing_seed_lot THEN
        RAISE EXCEPTION 'Row %: seed lot is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
      END IF;
      UPDATE phenotypes SET
        block = COALESCE(NULLIF(BTRIM(v_row->>'block'), ''), block),
        replicate = COALESCE((v_row->>'replicate')::INTEGER, replicate),
        location = COALESCE(NULLIF(BTRIM(v_row->>'location'), ''), location),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      IF v_family_code IS NULL THEN
        RAISE EXCEPTION 'Row %: a family code is required to create a phenotype', v_row->'row_index' USING ERRCODE = '23502';
      END IF;
      SELECT id INTO v_family_id FROM families WHERE program_id = target_program_id AND family_code = v_family_code AND deleted_at IS NULL;
      IF v_family_id IS NULL THEN
        RAISE EXCEPTION 'Row %: family code % not found in this program', v_row->'row_index', v_family_code USING ERRCODE = '23503';
      END IF;
      INSERT INTO phenotypes (program_id, family_id, seed_lot_id, phenotype_code, block, replicate, location, notes)
      VALUES (
        target_program_id, v_family_id, v_seed_lot_id, v_code,
        NULLIF(BTRIM(v_row->>'block'), ''),
        (v_row->>'replicate')::INTEGER,
        NULLIF(BTRIM(v_row->>'location'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id, phenotype_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_phenotypes(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_phenotypes(UUID, JSONB) TO authenticated;

-- Inventory is organization-scoped, not program-scoped, matching inventory_items/lots.
-- Quantity is never written directly: a new lot starts at initial_quantity = 0 and its
-- starting stock goes through the same receipt-movement path as
-- create_inventory_lot_with_receipt (000010) — a single 'receipt' movement for the full
-- amount, never a direct column write — so refresh_inventory_lot_on_movement_change
-- (000004) is the only writer of current_quantity, exactly as everywhere else in the app.
CREATE OR REPLACE FUNCTION public.import_inventory_lots(target_organization_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_actor_id UUID;
  v_item_name TEXT;
  v_item_id UUID;
  v_item_match_count INTEGER;
  v_batch TEXT;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_new_id UUID;
  v_initial_qty NUMERIC;
  v_item_unit TEXT;
BEGIN
  IF NOT can_write_team(target_organization_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_actor_id FROM profiles p WHERE p.user_id = auth.uid() AND p.is_active AND p.deleted_at IS NULL;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_item_name := NULLIF(BTRIM(v_row->>'item_name'), '');
    v_batch := NULLIF(BTRIM(v_row->>'batch_number'), '');
    IF v_item_name IS NULL OR v_batch IS NULL THEN
      RAISE EXCEPTION 'Row %: item name and batch number are required', v_row->'row_index' USING ERRCODE = '23502';
    END IF;

    SELECT COUNT(*) INTO v_item_match_count FROM inventory_items
    WHERE organization_id = target_organization_id AND deleted_at IS NULL AND LOWER(name) = LOWER(v_item_name);
    IF v_item_match_count = 0 THEN
      RAISE EXCEPTION 'Row %: inventory item "%" not found (no fuzzy matching; create it first)', v_row->'row_index', v_item_name USING ERRCODE = '23503';
    ELSIF v_item_match_count > 1 THEN
      RAISE EXCEPTION 'Row %: inventory item name "%" is ambiguous (matches more than one item)', v_row->'row_index', v_item_name USING ERRCODE = '23505';
    END IF;
    SELECT id, default_unit INTO v_item_id, v_item_unit FROM inventory_items
    WHERE organization_id = target_organization_id AND deleted_at IS NULL AND LOWER(name) = LOWER(v_item_name);

    SELECT id, deleted_at INTO v_existing_id, v_existing_deleted
    FROM inventory_lots WHERE inventory_item_id = v_item_id AND batch_number = v_batch;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: lot % is archived', v_row->'row_index', v_batch USING ERRCODE = '23514';
      END IF;
      UPDATE inventory_lots SET
        received_at = COALESCE((v_row->>'received_at')::DATE, received_at),
        expiration_date = COALESCE((v_row->>'expiration_date')::DATE, expiration_date),
        storage_location = COALESCE(NULLIF(BTRIM(v_row->>'storage_location'), ''), storage_location),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_batch);
    ELSE
      INSERT INTO inventory_lots (inventory_item_id, batch_number, received_at, expiration_date, initial_quantity, current_quantity, storage_location, notes)
      VALUES (
        v_item_id, v_batch,
        (v_row->>'received_at')::DATE,
        (v_row->>'expiration_date')::DATE,
        0, 0,
        NULLIF(BTRIM(v_row->>'storage_location'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id INTO v_new_id;
      v_initial_qty := (v_row->>'initial_quantity')::NUMERIC;
      IF v_initial_qty IS NOT NULL AND v_initial_qty > 0 THEN
        INSERT INTO inventory_movements (inventory_lot_id, movement_type, quantity, unit, movement_date, performed_by, reason)
        VALUES (v_new_id, 'receipt', v_initial_qty, v_item_unit, COALESCE((v_row->>'received_at')::DATE, CURRENT_DATE), v_actor_id, 'Import');
      END IF;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_batch);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_inventory_lots(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_inventory_lots(UUID, JSONB) TO authenticated;

-- A task always belongs to a real experimental cycle (validate_task_context, 000011,
-- rejects a NULL or cross-program experimental_cycle_id unconditionally) - there is no
-- "cycle-less task" anywhere else in the app, so cycle_name is required here too, not
-- optional. Status stays 'not_started'; assignment and status transitions remain out
-- of import scope (see docs). Dates are accepted as plain values here since a manually
-- created task has none of the template-generated scheduling invariants that
-- compute_cycle_template_schedule enforces.
CREATE OR REPLACE FUNCTION public.import_tasks(target_program_id UUID, rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row JSONB;
  v_results JSONB := '[]'::JSONB;
  v_existing_id UUID;
  v_existing_deleted TIMESTAMP;
  v_existing_cycle UUID;
  v_new_id UUID;
  v_code TEXT;
  v_cycle_name TEXT;
  v_cycle_id UUID;
  v_title TEXT;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(rows) LOOP
    v_code := NULLIF(BTRIM(v_row->>'task_code'), '');
    v_cycle_name := NULLIF(BTRIM(v_row->>'cycle_name'), '');
    v_title := NULLIF(BTRIM(v_row->>'title'), '');
    v_cycle_id := NULL;
    IF v_cycle_name IS NOT NULL THEN
      SELECT id INTO v_cycle_id FROM experimental_cycles WHERE program_id = target_program_id AND name = v_cycle_name AND deleted_at IS NULL;
      IF v_cycle_id IS NULL THEN
        RAISE EXCEPTION 'Row %: experimental cycle "%" not found in this program', v_row->'row_index', v_cycle_name USING ERRCODE = '23503';
      END IF;
    END IF;

    v_existing_id := NULL;
    IF v_code IS NOT NULL THEN
      SELECT id, deleted_at, experimental_cycle_id INTO v_existing_id, v_existing_deleted, v_existing_cycle
      FROM tasks WHERE program_id = target_program_id AND task_code = v_code;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'Row %: task % is archived', v_row->'row_index', v_code USING ERRCODE = '23514';
      END IF;
      IF v_cycle_name IS NOT NULL AND v_cycle_id IS DISTINCT FROM v_existing_cycle THEN
        RAISE EXCEPTION 'Row %: experimental cycle is an immutable identity field and cannot be changed by import', v_row->'row_index' USING ERRCODE = '23514';
      END IF;
      UPDATE tasks SET
        title = COALESCE(v_title, tasks.title),
        description = COALESCE(NULLIF(BTRIM(v_row->>'description'), ''), description),
        planned_date = COALESCE((v_row->>'planned_date')::DATE, planned_date),
        due_date = COALESCE((v_row->>'due_date')::DATE, due_date),
        zone = COALESCE(NULLIF(BTRIM(v_row->>'zone'), ''), zone),
        priority = COALESCE(NULLIF(BTRIM(v_row->>'priority'), ''), priority),
        sop_code = COALESCE(NULLIF(BTRIM(v_row->>'sop_code'), ''), sop_code),
        expected_deliverable = COALESCE(NULLIF(BTRIM(v_row->>'expected_deliverable'), ''), expected_deliverable),
        notes = COALESCE(NULLIF(BTRIM(v_row->>'notes'), ''), notes)
      WHERE id = v_existing_id;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'updated', 'id', v_existing_id, 'code', v_code);
    ELSE
      IF v_title IS NULL THEN
        RAISE EXCEPTION 'Row %: a title is required to create a task', v_row->'row_index' USING ERRCODE = '23502';
      END IF;
      IF v_cycle_id IS NULL THEN
        RAISE EXCEPTION 'Row %: an experimental cycle name is required to create a task', v_row->'row_index' USING ERRCODE = '23502';
      END IF;
      INSERT INTO tasks (
        program_id, experimental_cycle_id, task_code, title, description, planned_date, due_date,
        zone, priority, sop_code, expected_deliverable, notes
      ) VALUES (
        target_program_id, v_cycle_id, v_code, v_title,
        NULLIF(BTRIM(v_row->>'description'), ''),
        (v_row->>'planned_date')::DATE,
        (v_row->>'due_date')::DATE,
        NULLIF(BTRIM(v_row->>'zone'), ''),
        COALESCE(NULLIF(BTRIM(v_row->>'priority'), ''), 'medium'),
        NULLIF(BTRIM(v_row->>'sop_code'), ''),
        NULLIF(BTRIM(v_row->>'expected_deliverable'), ''),
        NULLIF(BTRIM(v_row->>'notes'), '')
      )
      RETURNING id, task_code INTO v_new_id, v_code;
      v_results := v_results || jsonb_build_object('row_index', v_row->'row_index', 'status', 'created', 'id', v_new_id, 'code', v_code);
    END IF;
  END LOOP;

  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_tasks(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_tasks(UUID, JSONB) TO authenticated;

-- PROMPT.md §13 requires "import" and "export" as audit_logs actions, but
-- audit_logs has had no direct client INSERT policy since 000012 (only the
-- narrowly-scoped record_user_admin_event for auth events) — this is the
-- matching function for the two new actions, same security idiom.
-- entity_id has no single natural value for a batch event, so it carries
-- the scope id (the program or organization the batch ran against).
CREATE OR REPLACE FUNCTION public.record_import_export_event(
  target_organization_id UUID,
  target_program_id UUID,
  event_action TEXT,
  target_entity_type TEXT,
  resulting_values JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  IF event_action NOT IN ('import', 'export') THEN
    RAISE EXCEPTION 'Unsupported audit action' USING ERRCODE = '22023';
  END IF;
  IF NOT can_write_team(target_organization_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_logs (organization_id, program_id, user_id, entity_type, entity_id, action, new_values)
  VALUES (
    target_organization_id, target_program_id, auth.uid(), target_entity_type,
    COALESCE(target_program_id, target_organization_id), event_action, resulting_values
  )
  RETURNING id INTO v_audit_id;
  RETURN v_audit_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_import_export_event(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_import_export_event(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;
