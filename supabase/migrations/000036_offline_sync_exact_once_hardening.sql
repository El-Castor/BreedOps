-- V2-07 exact-once hardening.
--
-- Security invariants:
-- 1. A browser-provided payload hash is never authoritative.
-- 2. PostgreSQL computes its own canonical payload hash.
-- 3. An idempotency receipt may only be replayed by the profile that created it.
-- 4. The authoritative program is derived from phenotype_id.
-- 5. Existing committed operations can be replayed before current-config checks.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Internal canonical hash used by PostgreSQL itself.
-- The caller-supplied p_payload_hash remains in the public RPC signature for
-- compatibility with migration 000035, but it is never trusted for
-- idempotency decisions after this migration.
CREATE FUNCTION public.offline_sync_payload_hash(
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'phenotypeId', p_phenotype_id::TEXT,
          'evaluationDate', to_char(p_evaluation_date, 'YYYY-MM-DD'),
          'values', p_submitted_values,
          'notes', to_jsonb(p_evaluation_notes)
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.offline_sync_payload_hash(
  UUID, DATE, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;


CREATE FUNCTION public.preflight_offline_sync_operation(
  p_operation_id UUID,
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT,
  p_payload_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  existing_receipt RECORD;
  v_actor_profile UUID;
  v_program_id UUID;
  v_phenotype_deleted TIMESTAMPTZ;
  v_server_payload_hash TEXT;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION
      'VALIDATION_REJECTED: operation_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- Never trust p_payload_hash. Recompute from the actual RPC payload.
  v_server_payload_hash := public.offline_sync_payload_hash(
    p_phenotype_id,
    p_evaluation_date,
    p_submitted_values,
    p_evaluation_notes
  );

  SELECT id
  INTO v_actor_profile
  FROM profiles
  WHERE user_id = auth.uid()
    AND is_active
    AND deleted_at IS NULL;

  IF v_actor_profile IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing_receipt
  FROM offline_sync_receipts
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    -- Idempotency keys are scoped to their creating actor.
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
      'program_id', existing_receipt.program_id,
      'replay', true
    );
  END IF;

  SELECT program_id, deleted_at
  INTO v_program_id, v_phenotype_deleted
  FROM phenotypes
  WHERE id = p_phenotype_id;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_phenotype_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'TARGET_ARCHIVED'
      USING ERRCODE = '23514';
  END IF;

  IF NOT can_write_program(v_program_id) THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'result_code', 'NEW',
    'program_id', v_program_id,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_offline_sync_operation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.preflight_offline_sync_operation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) TO authenticated;


CREATE OR REPLACE FUNCTION public.submit_offline_phenotype_evaluation(
  p_operation_id UUID,
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT,
  p_payload_hash TEXT
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
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION
      'VALIDATION_REJECTED: operation_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- The database derives the receipt hash from the actual mutation payload.
  -- p_payload_hash is deliberately not authoritative.
  v_server_payload_hash := public.offline_sync_payload_hash(
    p_phenotype_id,
    p_evaluation_date,
    p_submitted_values,
    p_evaluation_notes
  );

  lock_key := hashtextextended(p_operation_id::TEXT, 0);
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT id
  INTO v_actor_profile
  FROM profiles
  WHERE user_id = auth.uid()
    AND is_active
    AND deleted_at IS NULL;

  IF v_actor_profile IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing_receipt
  FROM offline_sync_receipts
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

  SELECT program_id, deleted_at
  INTO v_program_id, v_phenotype_deleted
  FROM phenotypes
  WHERE id = p_phenotype_id;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_phenotype_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'TARGET_ARCHIVED'
      USING ERRCODE = '23514';
  END IF;

  IF NOT can_write_program(v_program_id) THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id
  INTO v_organization_id
  FROM programs
  WHERE id = v_program_id;

  BEGIN
    v_evaluation_id := submit_trait_evaluation(
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

  INSERT INTO offline_sync_receipts(
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
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_offline_phenotype_evaluation(
  UUID, UUID, DATE, JSONB, TEXT, TEXT
) TO authenticated;
