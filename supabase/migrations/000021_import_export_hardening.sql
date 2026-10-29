-- Import/Export hardening, from a manual review of PR #6 (migration 000020 is
-- already applied on the retained database and is never edited here; every
-- function below is CREATE OR REPLACE with the same signature).
--
-- Three fixes, all server-side / PostgreSQL-authoritative:
--
-- 1. record_import_export_event only proved can_write_team(target_organization_id);
--    a non-null target_program_id was never checked against that organization_id,
--    so a forged pairing (the caller's own real organization_id alongside a
--    program_id belonging to a different team) could be recorded as an
--    internally-inconsistent audit_logs row. Fixed by requiring, when
--    target_program_id is not null: it is writable by the caller
--    (can_write_program, which also rejects an archived program, consistent
--    with every other write-scoped policy in the app) AND it structurally
--    belongs to target_organization_id. Either failure is '42501'.
--
-- 2. The business mutation (each import_* function) and its audit event were
--    two separate RPC calls from the application layer; the audit call's
--    result was discarded, so a successful import could silently produce no
--    audit record. Fixed by moving the record_import_export_event call to the
--    end of each import_* function's own body, inside the same implicit
--    transaction: if the audit insert is rejected (e.g. by fix 1 above, which
--    cannot actually happen here since target_program_id is always this same
--    function's own already-authorized target_program_id/target_organization_id,
--    but is kept as defense in depth) the whole call rolls back exactly like
--    any other mid-function failure, so the mutation and its audit event are
--    atomic from the application's perspective. The application layer no
--    longer calls record_import_export_event for imports at all (see the
--    matching src/app/app/import-export/actions.ts change); it still does for
--    exports, which have nothing to roll back (no business table is written),
--    but now checks that call's result and aborts the export on failure.

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
  IF target_program_id IS NOT NULL THEN
    IF NOT can_write_program(target_program_id) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM programs WHERE id = target_program_id AND organization_id = target_organization_id
    ) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'parent_lines',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'crosses',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'families',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'seed_lots',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'phenotypes',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_phenotypes(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_phenotypes(UUID, JSONB) TO authenticated;

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
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    target_organization_id, NULL, 'import', 'inventory_lots',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_inventory_lots(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_inventory_lots(UUID, JSONB) TO authenticated;

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
  v_organization_id UUID;
  v_created_count INTEGER := 0;
  v_updated_count INTEGER := 0;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = target_program_id;

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
      v_updated_count := v_updated_count + 1;
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
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM record_import_export_event(
    v_organization_id, target_program_id, 'import', 'tasks',
    jsonb_build_object('created', v_created_count, 'updated', v_updated_count, 'total_rows', jsonb_array_length(rows))
  );
  RETURN v_results;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_tasks(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_tasks(UUID, JSONB) TO authenticated;
