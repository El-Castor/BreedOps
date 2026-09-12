-- A profile's auth identity is immutable. Changing user_id could transfer
-- privileges or tenant membership to a different authenticated account.
CREATE FUNCTION public.guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Profile auth identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_profile_identity BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();

-- Trigger internals are not public RPC endpoints. Their owner still executes
-- them from database triggers after the invoking write passes RLS.
REVOKE EXECUTE ON FUNCTION public.refresh_phenotype_evaluation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_inventory_lot_quantity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_phenotype_evaluation_after_score_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_inventory_lot_after_movement_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_team_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT p.organization_id FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.user_id = auth.uid() AND p.is_active = true
    AND p.deleted_at IS NULL AND o.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE FUNCTION public.current_profile_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT role FROM public.profiles
  WHERE user_id = auth.uid() AND is_active AND deleted_at IS NULL;
$$;

DROP POLICY profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE
USING (user_id = auth.uid() AND is_active AND deleted_at IS NULL)
WITH CHECK (user_id = auth.uid() AND organization_id = current_team_id()
  AND role = current_profile_role());

-- Team administrators manage ordinary members, not privileged peers.
DROP POLICY profiles_team_admin_update ON public.profiles;
CREATE POLICY profiles_team_admin_update ON public.profiles FOR UPDATE
USING (is_system_admin() OR
  (is_team_admin() AND organization_id = current_team_id() AND role = 'user'))
WITH CHECK (is_system_admin() OR
  (is_team_admin() AND organization_id = current_team_id() AND role = 'user'));
