-- V2-07 offline configuration hardening.
--
-- Guarantees added after 000036:
-- 1. PostgreSQL is the authority for the offline configuration fingerprint.
-- 2. The fingerprint covers evaluation/scoring semantics, not only trait bounds.
-- 3. Pack creation can obtain active traits + fingerprint from one DB snapshot.
-- 4. A NEW offline mutation verifies its pack fingerprint inside the same
--    transaction as the scientific write.
-- 5. Configuration tables are protected by SHARE locks for the short mutation
--    transaction, eliminating the check/write TOCTOU window.
-- 6. Existing idempotency receipts still replay before any current-config check.

-- ───────────────────── Authoritative configuration fingerprint ─────────────────────

CREATE FUNCTION public.offline_sync_configuration_fingerprint(
  p_program_id UUID
) RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH active_traits_document AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'traitId', t.trait_id::TEXT,
          'code', t.code,
          'dataType', t.data_type,
          'unit', t.unit,
          'minimumValue', t.minimum_value,
          'maximumValue', t.maximum_value,
          'decimalPlaces', t.decimal_places,
          'allowedValues',
            CASE
              WHEN t.allowed_values IS NULL THEN NULL
              ELSE to_jsonb(
                ARRAY(
                  SELECT value
                  FROM unnest(t.allowed_values) AS value
                  ORDER BY value
                )
              )
            END,
          'moduleId', t.module_id::TEXT
        )
        ORDER BY t.trait_id
      ),
      '[]'::JSONB
    ) AS document
    FROM public.program_active_traits(p_program_id) AS t
  ),
  active_models_document AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'modelId', m.id::TEXT,
          'maximumScore', m.maximum_score,
          'criteria',
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'criterionId', c.id::TEXT,
                    'traitId', c.trait_id::TEXT,
                    'code', c.code,
                    'name', c.name,
                    'coefficient', c.coefficient,
                    'minimumValue', c.minimum_value,
                    'maximumValue', c.maximum_value,
                    'isEliminatory', COALESCE(c.is_eliminatory, FALSE),
                    'eliminatoryThreshold', c.eliminatory_threshold
                  )
                  ORDER BY c.code, c.trait_id::TEXT
                )
                FROM public.selection_criteria AS c
                WHERE c.selection_model_id = m.id
                  AND c.deleted_at IS NULL
              ),
              '[]'::JSONB
            ),
          'decisionRules',
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'decision', r.decision,
                    'minimumWeightedScore', r.minimum_weighted_score,
                    'minimumStabilityScore', r.minimum_stability_score,
                    'displayOrder', r.display_order
                  )
                  ORDER BY r.display_order, r.decision
                )
                FROM public.selection_decision_rules AS r
                WHERE r.selection_model_id = m.id
                  AND r.deleted_at IS NULL
              ),
              '[]'::JSONB
            )
        )
        ORDER BY m.created_at, m.id
      ),
      '[]'::JSONB
    ) AS document
    FROM public.selection_models AS m
    WHERE m.program_id = p_program_id
      AND m.is_active
      AND m.deleted_at IS NULL
  )
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'activeTraits', active_traits_document.document,
          'activeSelectionModels', active_models_document.document
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM active_traits_document, active_models_document;
$$;

REVOKE ALL ON FUNCTION public.offline_sync_configuration_fingerprint(UUID)
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.offline_sync_configuration_fingerprint(UUID) IS
  'Internal authoritative SHA-256 of all configuration that can affect an offline phenotype evaluation: active trait validity, active selection models, criteria/weights/eliminatory gates, maximum score and decision rules.';


-- ───────────────────── Atomic pack configuration snapshot ─────────────────────
--
-- active_traits and fingerprint are produced by one top-level SQL statement,
-- therefore they observe the same PostgreSQL statement snapshot.

CREATE FUNCTION public.offline_sync_program_configuration(
  p_program_id UUID
) RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jsonb_build_object(
    'fingerprint',
      public.offline_sync_configuration_fingerprint(p_program_id),
    'active_traits',
      COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(t)
            ORDER BY t.module_order, t.module_name, t.trait_order, t.trait_id
          )
          FROM public.program_active_traits(p_program_id) AS t
        ),
        '[]'::JSONB
      )
  )
  WHERE public.can_access_program(p_program_id);
$$;

REVOKE ALL ON FUNCTION public.offline_sync_program_configuration(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.offline_sync_program_configuration(UUID)
TO authenticated;

COMMENT ON FUNCTION public.offline_sync_program_configuration(UUID) IS
  'Returns the offline pack active-trait snapshot and its authoritative configuration fingerprint from one database statement snapshot.';


-- ───────────────────── Transaction-safe offline submit ─────────────────────
--
-- The old six-argument function from 000036 remains installed for migration
-- history/diagnostics, but authenticated application callers may no longer use
-- it because it has no configuration fingerprint parameter.

REVOKE EXECUTE ON FUNCTION public.submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) FROM authenticated;


CREATE FUNCTION public.submit_offline_phenotype_evaluation(
  p_operation_id UUID,
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT,
  p_payload_hash TEXT,
  p_pack_configuration_fingerprint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  lock_key BIGINT;
  existing_receipt RECORD;
  v_actor_profile UUID;
  v_program_id UUID;
  v_organization_id UUID;
  v_phenotype_deleted TIMESTAMPTZ;
  v_evaluation_id UUID;
  v_server_payload_hash TEXT;
  v_current_configuration_fingerprint TEXT;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION
      'VALIDATION_REJECTED: operation_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_pack_configuration_fingerprint IS NULL
     OR btrim(p_pack_configuration_fingerprint) = '' THEN
    RAISE EXCEPTION
      'VALIDATION_REJECTED: pack configuration fingerprint is required'
      USING ERRCODE = '22023';
  END IF;

  -- Browser/client payload hashes remain non-authoritative.
  v_server_payload_hash := public.offline_sync_payload_hash(
    p_phenotype_id,
    p_evaluation_date,
    p_submitted_values,
    p_evaluation_notes
  );

  -- Serialize retries of the same idempotency operation.
  lock_key := hashtextextended(p_operation_id::TEXT, 0);
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT id
  INTO v_actor_profile
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND is_active
    AND deleted_at IS NULL;

  IF v_actor_profile IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  -- Exact-once replay MUST happen before looking at current configuration.
  SELECT *
  INTO existing_receipt
  FROM public.offline_sync_receipts
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    IF existing_receipt.profile_id IS DISTINCT FROM v_actor_profile THEN
      RAISE EXCEPTION 'PERMISSION_REVOKED'
        USING ERRCODE = '42501';
    END IF;

    IF existing_receipt.payload_hash IS DISTINCT FROM v_server_payload_hash THEN
      RAISE EXCEPTION
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'result_code', 'SYNCED',
      'evaluation_id', existing_receipt.result_entity_id,
      'replay', true
    );
  END IF;

  -- Authoritative scope still comes only from phenotype_id.
  SELECT program_id, deleted_at
  INTO v_program_id, v_phenotype_deleted
  FROM public.phenotypes
  WHERE id = p_phenotype_id;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_phenotype_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'TARGET_ARCHIVED'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.can_write_program(v_program_id) THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  -- These are every configuration table consulted either by
  -- program_active_traits(), submit_trait_evaluation() or
  -- refresh_phenotype_evaluation().
  --
  -- SHARE permits concurrent readers/offline submissions but conflicts with
  -- INSERT/UPDATE/DELETE's ROW EXCLUSIVE lock. A configuration edit already
  -- running finishes first; a new edit waits until this scientific write
  -- commits. This establishes an unambiguous ordering and closes the TOCTOU
  -- window without requiring every configuration writer to participate in a
  -- bespoke advisory-lock protocol.
  LOCK TABLE
    public.program_phenotyping_modules,
    public.phenotyping_modules,
    public.phenotyping_module_traits,
    public.phenotype_traits,
    public.selection_models,
    public.selection_criteria,
    public.selection_decision_rules
  IN SHARE MODE;

  v_current_configuration_fingerprint :=
    public.offline_sync_configuration_fingerprint(v_program_id);

  IF v_current_configuration_fingerprint
       IS DISTINCT FROM p_pack_configuration_fingerprint THEN
    RAISE EXCEPTION 'CONFIG_CHANGED'
      USING ERRCODE = '23514';
  END IF;

  SELECT organization_id
  INTO v_organization_id
  FROM public.programs
  WHERE id = v_program_id;

  -- Single authoritative scientific validation/write path.
  BEGIN
    v_evaluation_id := public.submit_trait_evaluation(
      p_phenotype_id,
      p_evaluation_date,
      p_submitted_values,
      p_evaluation_notes
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'VALIDATION_REJECTED: %',
      SQLERRM
      USING ERRCODE = SQLSTATE;
  END;

  INSERT INTO public.offline_sync_receipts(
    operation_id,
    organization_id,
    program_id,
    profile_id,
    operation_type,
    payload_hash,
    result_entity_id
  )
  VALUES (
    p_operation_id,
    v_organization_id,
    v_program_id,
    v_actor_profile,
    'PHENOTYPE_TRAIT_EVALUATION',
    v_server_payload_hash,
    v_evaluation_id
  );

  RETURN jsonb_build_object(
    'result_code', 'SYNCED',
    'evaluation_id', v_evaluation_id,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT, TEXT
) IS
  'V2-07 exact-once offline submission with transaction-safe authoritative configuration fingerprint validation.';
