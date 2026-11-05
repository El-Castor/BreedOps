-- V2-05: legacy location/material mapping workflow (B41).
-- Additive only; 000001-000028 are left untouched. No column, trigger, or
-- RLS policy is added - every phenotype row that already satisfies RLS
-- for its own program already works with these functions, since they
-- touch only environment_id/trial_entry_id (never deleted_at) and run
-- SECURITY INVOKER, inheriting the caller's own phenotypes_update policy.
--
-- Purpose: `phenotypes.location` (free text) and `family_id`/`seed_lot_id`
-- are never auto-migrated into the new normalized sites/environments/
-- trial_entries model (B8/B41) - a human explicitly maps each distinct
-- legacy value to a normalized entity, once, through the UI. These four
-- functions are the one server-side mechanism that mapping goes through:
-- two read-only summaries (what legacy data is still unmapped) and two
-- bulk-update functions (apply one mapping decision to every matching,
-- still-unmapped phenotype at once) - never a silent per-row heuristic.

-- ───────── Read-only summaries: what remains unmapped ─────────

CREATE FUNCTION public.legacy_phenotype_location_summary(target_program_id UUID)
RETURNS TABLE (location TEXT, phenotype_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT p.location, count(*)
  FROM phenotypes p
  WHERE p.program_id = target_program_id
    AND p.deleted_at IS NULL
    AND p.environment_id IS NULL
    AND p.location IS NOT NULL
    AND can_access_program(target_program_id)
  GROUP BY p.location
  ORDER BY count(*) DESC, p.location;
$$;
REVOKE ALL ON FUNCTION public.legacy_phenotype_location_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_phenotype_location_summary(UUID) TO authenticated;
COMMENT ON FUNCTION public.legacy_phenotype_location_summary IS
  'Distinct free-text phenotypes.location values that still have no environment_id, for the mapping workflow (B41) to offer. Never auto-interprets a location string as an environment.';

CREATE FUNCTION public.legacy_phenotype_material_summary(target_program_id UUID)
RETURNS TABLE (
  family_id UUID, family_code TEXT,
  seed_lot_id UUID, seed_lot_code TEXT,
  phenotype_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT p.family_id, f.family_code, p.seed_lot_id, sl.seed_lot_code, count(*)
  FROM phenotypes p
  LEFT JOIN families f ON f.id = p.family_id
  LEFT JOIN seed_lots sl ON sl.id = p.seed_lot_id
  WHERE p.program_id = target_program_id
    AND p.deleted_at IS NULL
    AND p.trial_entry_id IS NULL
    AND (p.family_id IS NOT NULL OR p.seed_lot_id IS NOT NULL)
    AND can_access_program(target_program_id)
  GROUP BY p.family_id, f.family_code, p.seed_lot_id, sl.seed_lot_code
  ORDER BY count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.legacy_phenotype_material_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_phenotype_material_summary(UUID) TO authenticated;
COMMENT ON FUNCTION public.legacy_phenotype_material_summary IS
  'Distinct existing family_id/seed_lot_id combinations still unlinked to a trial_entry_id, for the mapping workflow (B41) to offer. Never auto-interprets family_id/seed_lot_id as a genotype/entry identity (task review finding) - it only offers them as candidates for an explicit, human-made mapping.';

-- ───────── Bulk mapping: apply one decision to every matching row ─────────

CREATE FUNCTION public.map_legacy_location_to_environment(
  target_program_id UUID,
  target_location TEXT,
  target_environment_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE phenotypes
  SET environment_id = target_environment_id
  WHERE program_id = target_program_id
    AND deleted_at IS NULL
    AND environment_id IS NULL
    AND location = target_location;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
REVOKE ALL ON FUNCTION public.map_legacy_location_to_environment(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.map_legacy_location_to_environment(UUID, TEXT, UUID) TO authenticated;
COMMENT ON FUNCTION public.map_legacy_location_to_environment IS
  'Applies one explicit location -> environment mapping decision to every still-unmapped phenotype sharing that exact location text, in this program. SECURITY INVOKER: the caller''s own phenotypes_update RLS policy (can_write_program) and validate_phenotype_met_links trigger both still apply - this is not a privilege escalation path. Never touches a phenotype that already has an environment_id (never overwrites an existing mapping). Returns the number of rows updated.';

CREATE FUNCTION public.map_legacy_material_to_trial_entry(
  target_program_id UUID,
  target_family_id UUID,
  target_seed_lot_id UUID,
  target_trial_entry_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  entry_trial_id UUID;
  updated_count INTEGER;
BEGIN
  SELECT trial_id INTO entry_trial_id FROM trial_entries WHERE id = target_trial_entry_id AND deleted_at IS NULL;
  IF entry_trial_id IS NULL THEN
    RAISE EXCEPTION 'trial_entry_id could not be resolved' USING ERRCODE = '23514';
  END IF;
  -- Only maps a phenotype whose existing environment_id (if any) is
  -- already one of the target trial_entry's own trial's environments -
  -- otherwise validate_phenotype_met_links would reject that one row and
  -- abort the whole UPDATE (it is one statement, never a partial
  -- bulk-apply): this keeps the bulk mapping honest about exactly which
  -- rows it can safely touch rather than failing opaquely on the first
  -- mismatched one.
  UPDATE phenotypes p
  SET trial_entry_id = target_trial_entry_id
  WHERE p.program_id = target_program_id
    AND p.deleted_at IS NULL
    AND p.trial_entry_id IS NULL
    AND (p.family_id, p.seed_lot_id) IS NOT DISTINCT FROM (target_family_id, target_seed_lot_id)
    AND (
      p.environment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM trial_environments te
        WHERE te.trial_id = entry_trial_id AND te.environment_id = p.environment_id
      )
    );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
REVOKE ALL ON FUNCTION public.map_legacy_material_to_trial_entry(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.map_legacy_material_to_trial_entry(UUID, UUID, UUID, UUID) TO authenticated;
COMMENT ON FUNCTION public.map_legacy_material_to_trial_entry IS
  'Applies one explicit (family_id, seed_lot_id) -> trial_entry_id mapping decision to every still-unmapped phenotype sharing that exact material identity, in this program - skipping (not failing on) any row whose existing environment_id is not one of the target trial_entry''s own trial''s environments, so one inconsistent row never aborts the whole batch. SECURITY INVOKER: the caller''s own phenotypes_update RLS policy and validate_phenotype_met_links trigger both still apply. Never touches a phenotype that already has a trial_entry_id. Returns the number of rows updated.';
