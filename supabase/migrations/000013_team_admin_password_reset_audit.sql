-- Team administrators may initiate password resets for ordinary users in their team.
CREATE OR REPLACE FUNCTION public.record_user_admin_event(
  target_user_id uuid,
  target_organization_id uuid,
  event_action text,
  previous_values jsonb DEFAULT NULL,
  resulting_values jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  audit_id uuid;
BEGIN
  IF event_action NOT IN (
    'user_invited', 'user_created', 'user_activated', 'user_deactivated',
    'user_role_changed', 'user_team_changed', 'admin_password_reset'
  ) THEN
    RAISE EXCEPTION 'Unsupported audit action' USING ERRCODE = '22023';
  END IF;
  IF NOT is_system_admin() AND NOT (
    is_team_admin()
    AND target_organization_id = current_team_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = target_user_id
        AND p.organization_id = target_organization_id
        AND p.role = 'user'
        AND p.deleted_at IS NULL
    )
    AND event_action IN (
      'user_invited', 'user_created', 'user_activated', 'user_deactivated',
      'admin_password_reset'
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_logs(
    organization_id, user_id, entity_type, entity_id, action,
    old_values, new_values
  ) VALUES (
    target_organization_id, auth.uid(), 'auth_user', target_user_id,
    event_action, previous_values, resulting_values
  ) RETURNING id INTO audit_id;
  RETURN audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_user_admin_event(uuid,uuid,text,jsonb,jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_admin_event(uuid,uuid,text,jsonb,jsonb)
TO authenticated;
