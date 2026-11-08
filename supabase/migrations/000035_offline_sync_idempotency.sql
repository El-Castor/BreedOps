-- V2-07 (Offline Mode / PWA): exact-once synchronization for phenotype
-- evaluations captured while offline.
--
-- submit_trait_evaluation() (000016_configurable_phenotyping.sql) creates a
-- NEW phenotype_evaluations row on every call - by design, for the normal
-- online form where one click means one evaluation. An offline-queued
-- operation can legitimately be sent to the server more than once (the
-- device goes offline again mid-request, the client never receives the
-- ack, the app is closed and reopened before a retry completes) and must
-- never create a second scientific observation for the same client-side
-- operation. This migration adds an idempotency ledger
-- (offline_sync_receipts) and a SECURITY DEFINER wrapper
-- (submit_offline_phenotype_evaluation) that is the only way the V2-07
-- sync endpoint (src/app/api/offline-sync/route.ts) is allowed to create a
-- phenotype evaluation - it never calls submit_trait_evaluation() directly
-- offline, and never bypasses its validation (V2-07 §14): the wrapper
-- delegates to it unconditionally for the actual scientific write.
--
-- Additive only: 000001-000034 are left untouched, per "never modify a
-- historical migration".

CREATE TABLE public.offline_sync_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The client-generated idempotency key (V2-07 §12). UNIQUE is the actual
  -- correctness guarantee under concurrency; the advisory lock inside
  -- submit_offline_phenotype_evaluation() below only avoids a wasted
  -- duplicate INSERT attempt racing on it, it is not itself what prevents
  -- the duplicate.
  operation_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type = 'PHENOTYPE_TRAIT_EVALUATION'),
  -- Canonical hash of the operation's payload (src/lib/offline/payload-hash.ts),
  -- computed identically client- and server-side. A retry of the exact same
  -- operation_id must carry the exact same hash; a mismatch means the
  -- operation_id was reused for different content and is rejected outright
  -- (V2-07 §13, §34) rather than silently accepted or silently ignored.
  payload_hash TEXT NOT NULL,
  -- The phenotype_evaluations row this operation produced. Immutable once
  -- set; a retry returns this same id rather than creating another row.
  result_entity_id UUID NOT NULL REFERENCES public.phenotype_evaluations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.offline_sync_receipts IS
  'Append-only idempotency ledger for offline-synchronized phenotype evaluations (V2-07). Never updated or deleted by application code - see submit_offline_phenotype_evaluation().';

CREATE INDEX offline_sync_receipts_org_program_idx
  ON public.offline_sync_receipts(organization_id, program_id);
CREATE INDEX offline_sync_receipts_profile_idx
  ON public.offline_sync_receipts(profile_id);

ALTER TABLE public.offline_sync_receipts ENABLE ROW LEVEL SECURITY;

-- Read-only for same-org members (support/debugging visibility into what
-- has been synced). No INSERT/UPDATE/DELETE policy is defined for
-- `authenticated` at all: every write happens exclusively through
-- submit_offline_phenotype_evaluation() below, which (like
-- submit_trait_evaluation()) runs SECURITY DEFINER and is therefore not
-- itself subject to this table's RLS policies - the receipt table is
-- deliberately append-only and tamper-resistant from the application's own
-- normal session role.
CREATE POLICY offline_sync_receipts_read ON public.offline_sync_receipts FOR SELECT
  USING (can_access_team(organization_id));

REVOKE ALL ON public.offline_sync_receipts FROM PUBLIC, anon;
GRANT SELECT ON public.offline_sync_receipts TO authenticated;

-- ───────────────────────── Idempotent submission wrapper ─────────────────────────
--
-- Deliberately takes only what identifies the operation and its target
-- phenotype - never a client-asserted organization_id/program_id/trial_id.
-- The program (and therefore the organization and every authorization
-- check) is re-derived here from phenotype_id, exactly as
-- submit_trait_evaluation() already does, so a client cannot influence
-- which program's authorization check applies by lying about scope in the
-- request body (the same "never trust client-asserted scope" principle as
-- the V2-06 source-run hardening). Pack-configuration-fingerprint
-- comparison (CONFIG_CHANGED) is a separate, non-authoritative UX check
-- performed by the caller (src/app/api/offline-sync/route.ts) before this
-- function is ever invoked - the authoritative scientific validation below
-- is unconditional either way.
CREATE FUNCTION public.submit_offline_phenotype_evaluation(
  p_operation_id UUID,
  p_phenotype_id UUID,
  p_evaluation_date DATE,
  p_submitted_values JSONB,
  p_evaluation_notes TEXT,
  p_payload_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lock_key BIGINT;
  existing_receipt RECORD;
  v_actor_profile UUID;
  v_program_id UUID;
  v_organization_id UUID;
  v_phenotype_deleted TIMESTAMPTZ;
  v_evaluation_id UUID;
BEGIN
  IF p_operation_id IS NULL OR p_payload_hash IS NULL OR btrim(p_payload_hash) = '' THEN
    RAISE EXCEPTION 'VALIDATION_REJECTED: operation_id and payload_hash are required' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent requests carrying the SAME operation_id within
  -- this transaction - held until commit/rollback, so a second request for
  -- the same operation_id blocks here until the first has fully finished
  -- (including its receipt INSERT below), rather than both racing past the
  -- "does a receipt already exist" check and creating two evaluations
  -- before the UNIQUE constraint on operation_id can stop them.
  lock_key := hashtextextended(p_operation_id::TEXT, 0);
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT id INTO v_actor_profile FROM profiles
  WHERE user_id = auth.uid() AND is_active AND deleted_at IS NULL;
  IF v_actor_profile IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_receipt FROM offline_sync_receipts WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF existing_receipt.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' USING ERRCODE = '23505';
    END IF;
    -- Exact replay of an already-processed operation: return the existing
    -- result without calling submit_trait_evaluation() again - this is the
    -- "exact-once" guarantee (V2-07 §13, §33), not a second observation.
    RETURN jsonb_build_object(
      'result_code', 'SYNCED', 'evaluation_id', existing_receipt.result_entity_id, 'replay', true);
  END IF;

  -- SECURITY DEFINER lets this distinguish "never existed" from "exists
  -- but soft-deleted" for the structured TARGET_NOT_FOUND vs
  -- TARGET_ARCHIVED codes (V2-07 §16) - an RLS-filtered SELECT the client
  -- could run cannot tell those apart. `deleted_at` is the only archival
  -- concept phenotypes currently has (the legacy `status` free-text column
  -- is not wired into any business rule in this codebase), so it is what
  -- TARGET_ARCHIVED is defined against here.
  SELECT program_id, deleted_at INTO v_program_id, v_phenotype_deleted
  FROM phenotypes WHERE id = p_phenotype_id;
  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_phenotype_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'TARGET_ARCHIVED' USING ERRCODE = '23514';
  END IF;
  IF NOT can_write_program(v_program_id) THEN
    RAISE EXCEPTION 'PERMISSION_REVOKED' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_organization_id FROM programs WHERE id = v_program_id;

  -- The single authoritative scientific-validation and write path - never
  -- a divergent copy (V2-07 §14). Any failure inside (unknown trait,
  -- out-of-bounds value, wrong type, notes too long, ...) is caught here
  -- and re-raised as VALIDATION_REJECTED so the sync endpoint has one
  -- stable code to report, while the original message is preserved for
  -- the user-facing detail. The implicit savepoint this EXCEPTION block
  -- creates means any partial INSERTs submit_trait_evaluation() made
  -- before failing are rolled back - no half-written evaluation survives
  -- a validation rejection.
  BEGIN
    v_evaluation_id := submit_trait_evaluation(
      p_phenotype_id, p_evaluation_date, p_submitted_values, p_evaluation_notes);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'VALIDATION_REJECTED: %', SQLERRM USING ERRCODE = SQLSTATE;
  END;

  INSERT INTO offline_sync_receipts(
    operation_id, organization_id, program_id, profile_id, operation_type,
    payload_hash, result_entity_id)
  VALUES (
    p_operation_id, v_organization_id, v_program_id, v_actor_profile,
    'PHENOTYPE_TRAIT_EVALUATION', p_payload_hash, v_evaluation_id);

  RETURN jsonb_build_object(
    'result_code', 'SYNCED', 'evaluation_id', v_evaluation_id, 'replay', false);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_offline_phenotype_evaluation(UUID, UUID, DATE, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_offline_phenotype_evaluation(UUID, UUID, DATE, JSONB, TEXT, TEXT) TO authenticated;
