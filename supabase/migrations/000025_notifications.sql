-- V2-02: internal notification center.
--
-- Design (see agend.md for the full audit this follows):
--  * Every notification row has exactly one recipient_profile_id - never a
--    shared "team-wide" row with ambiguous per-user read state. A condition
--    that is relevant to several people (e.g. low stock) is fanned out to
--    one row per active recipient at generation time. This keeps RLS and
--    "mark as read" trivially correct: a notification is always owned by
--    exactly the profile it was generated for.
--  * dedup_key is globally unique and deterministic per (condition,
--    recipient), so re-running the generator never creates duplicates and a
--    page reload is always idempotent. A dedup_key collision while the
--    existing row is still active (resolved_at IS NULL) is a true no-op
--    (ON CONFLICT ... WHERE leaves the row untouched, same as DO NOTHING -
--    read_at is never disturbed by a repeat sync). A collision against an
--    already-resolved row is instead a reactivation: the same logical
--    condition recurred (e.g. stock dropped below the threshold again
--    after being replenished), so the one row for that (condition,
--    recipient) pair is flipped back to active/unread and its
--    presentation fields and created_at are refreshed - never a second
--    row for the same dedup_key, and never silently stuck resolved
--    forever once the condition becomes true again.
--  * resolved_at marks a notification whose underlying condition is no
--    longer true (task completed, stock replenished, ...). Resolved rows
--    are kept (never deleted) as a harmless history trail, matching this
--    schema's existing soft-delete philosophy, but are excluded from the
--    default "active" feed and from the unread counter.
--  * No cron/scheduler exists yet in this architecture (audited: no
--    pg_cron, no scheduled GitHub Actions workflow). sync_notifications_for_team()
--    is therefore called from the authenticated app shell on every page
--    load (see src/app/app/layout.tsx) rather than on a timer. It is
--    designed to be called unchanged from a future pg_cron job or scheduled
--    Edge Function - it takes an explicit organization_id, re-checks
--    authorization itself, and does not depend on any request-scoped state
--    beyond that argument. Documented as a known interim limitation: a
--    condition that newly becomes true while nobody opens the app will not
--    be surfaced until someone next does.
--  * Email is explicitly out of scope for this milestone (see agend.md,
--    EMAIL_DISPATCH_STATUS=DEFERRED): this internal center is the primary,
--    always-on channel the spec requires, and it is fully implemented and
--    tested. A separate email channel would need either a real
--    scheduler/cron (none exists yet, same gap as above) or triggering a
--    privileged lookup of another profile's email address as a side
--    effect of an unrelated user's own page load (the low-stock/due-soon
--    fan-out targets other recipients than the one making the request) -
--    neither is shipped half-built here.

CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id UUID REFERENCES public.programs(id) ON DELETE CASCADE,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('task_overdue','task_due_soon','stock_low','lot_expiring')),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  dedup_key TEXT NOT NULL,
  read_at TIMESTAMP,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notifications IS
  'Internal notification center. One row per (condition, recipient) - see migration header for the fan-out/dedup/resolve design.';
COMMENT ON COLUMN public.notifications.dedup_key IS
  'Deterministic per (category, source entity id, recipient_profile_id). Unique index makes the generator''s upsert idempotent.';
COMMENT ON COLUMN public.notifications.resolved_at IS
  'Set once the underlying condition stops being true. Resolved rows are kept for history but excluded from the default feed and unread count.';

CREATE UNIQUE INDEX notifications_dedup_key_key ON public.notifications(dedup_key);
CREATE INDEX idx_notifications_recipient_active ON public.notifications(recipient_profile_id, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_notifications_org ON public.notifications(organization_id);

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- A notification is only ever visible to the single profile it was
-- generated for - there is no team-wide/broadcast row (see migration
-- header), so this is the entire authorization surface for SELECT.
CREATE POLICY notifications_read ON public.notifications FOR SELECT
  USING (recipient_profile_id = current_profile_id());

-- No UPDATE/INSERT policy or grant exists for "authenticated" - unlike
-- every other mutable table in this schema, notifications is never
-- written to directly by a client request (not even the owning
-- recipient's own row). Both mutation paths below are therefore
-- SECURITY DEFINER functions that re-check ownership/authorization
-- themselves in their own body, exactly like sync_notifications_for_team
-- and every other write-capable function in this schema (e.g.
-- record_import_export_event, set_program_trait_weight). This closes off
-- a raw PostgREST PATCH against the table, which a plain
-- "GRANT UPDATE ... WITH CHECK (recipient_profile_id = ...)" policy would
-- otherwise still allow a recipient to send against their own row -
-- letting them rewrite title/body/severity or set resolved_at directly
-- (self-silencing a real, still-true alert without fixing it).
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;

CREATE FUNCTION public.mark_notification_read(target_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = target_id AND recipient_profile_id = current_profile_id();
$$;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

CREATE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.notifications
  SET read_at = now()
  WHERE recipient_profile_id = current_profile_id()
    AND read_at IS NULL
    AND resolved_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- Computes the current set of task/inventory conditions for one
-- organization and reconciles it against existing rows: inserts newly-true
-- conditions (ON CONFLICT on dedup_key makes this a no-op on repeat calls),
-- and resolves (resolved_at = now()) previously-active rows whose condition
-- is no longer true. SECURITY DEFINER because it writes notifications on
-- behalf of other profiles in the team (the assignee of a task someone
-- else is viewing, every active member for a stock alert) - the RLS
-- policies above deliberately do not allow that directly. Re-checks
-- authorization itself immediately, exactly like every other
-- SECURITY DEFINER function in this schema (e.g. record_import_export_event).
CREATE FUNCTION public.sync_notifications_for_team(target_organization_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  active_keys TEXT[];
  inserted_count INT;
  resolved_count INT;
BEGIN
  IF NOT can_access_team(target_organization_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- ───────── task_overdue / task_due_soon ─────────
  -- Recipient is the assignee when one is set; otherwise every team_admin
  -- of the organization (someone must still be able to act on it).
  WITH candidate_tasks AS (
    SELECT
      t.id AS task_id,
      t.program_id,
      t.title,
      t.due_date,
      t.assigned_to,
      CASE WHEN t.due_date < CURRENT_DATE THEN 'task_overdue' ELSE 'task_due_soon' END AS category,
      CASE WHEN t.due_date < CURRENT_DATE THEN 'critical' ELSE 'warning' END AS severity
    FROM tasks t
    JOIN programs pr ON pr.id = t.program_id AND pr.deleted_at IS NULL
    WHERE pr.organization_id = target_organization_id
      AND t.deleted_at IS NULL
      AND t.completed_at IS NULL
      AND t.status NOT IN ('completed', 'cancelled')
      AND t.due_date IS NOT NULL
      AND t.due_date <= CURRENT_DATE + 3
  ),
  task_recipients AS (
    SELECT ct.*, ct.assigned_to AS recipient_profile_id
    FROM candidate_tasks ct
    WHERE ct.assigned_to IS NOT NULL
    UNION ALL
    SELECT ct.*, admin.id AS recipient_profile_id
    FROM candidate_tasks ct
    JOIN profiles admin
      ON admin.organization_id = target_organization_id
      AND admin.role = 'team_admin'
      AND admin.is_active
      AND admin.deleted_at IS NULL
    WHERE ct.assigned_to IS NULL
  ),
  task_rows AS (
    SELECT
      target_organization_id AS organization_id,
      program_id,
      recipient_profile_id,
      category,
      severity,
      CASE WHEN category = 'task_overdue'
        THEN 'Tâche en retard : ' || title
        ELSE 'Échéance proche : ' || title
      END AS title,
      to_char(due_date, 'DD/MM/YYYY') AS body,
      '/app/operations?program=' || program_id || '&tab=tasks' AS link_path,
      category || ':' || task_id || ':' || recipient_profile_id AS dedup_key
    FROM task_recipients
  ),
  -- ───────── stock_low / lot_expiring ─────────
  -- Inventory is organization-scoped, not program-scoped, and relevant to
  -- every active team member (not just admins) - fanned out team-wide.
  candidate_items AS (
    SELECT
      i.id AS item_id,
      i.name,
      i.minimum_stock,
      (SELECT COALESCE(sum(l.current_quantity), 0) FROM inventory_lots l
        WHERE l.inventory_item_id = i.id AND l.deleted_at IS NULL) AS total_quantity
    FROM inventory_items i
    WHERE i.organization_id = target_organization_id AND i.deleted_at IS NULL
  ),
  low_items AS (
    SELECT item_id, name FROM candidate_items WHERE total_quantity <= minimum_stock
  ),
  candidate_lots AS (
    SELECT l.id AS lot_id, l.batch_number, l.expiration_date, i.name AS item_name
    FROM inventory_lots l
    JOIN inventory_items i ON i.id = l.inventory_item_id
    WHERE i.organization_id = target_organization_id
      AND i.deleted_at IS NULL
      AND l.deleted_at IS NULL
      AND l.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
  ),
  team_members AS (
    SELECT id AS recipient_profile_id FROM profiles
    WHERE organization_id = target_organization_id AND is_active AND deleted_at IS NULL
  ),
  inventory_rows AS (
    SELECT
      target_organization_id AS organization_id,
      NULL::uuid AS program_id,
      tm.recipient_profile_id,
      'stock_low' AS category,
      'warning' AS severity,
      'Stock faible : ' || li.name AS title,
      NULL::text AS body,
      '/app/inventory' AS link_path,
      'stock_low:' || li.item_id || ':' || tm.recipient_profile_id AS dedup_key
    FROM low_items li CROSS JOIN team_members tm
    UNION ALL
    SELECT
      target_organization_id,
      NULL::uuid,
      tm.recipient_profile_id,
      'lot_expiring',
      'warning',
      'Péremption proche : ' || cl.item_name || CASE WHEN cl.batch_number IS NOT NULL THEN ' (' || cl.batch_number || ')' ELSE '' END,
      to_char(cl.expiration_date, 'DD/MM/YYYY'),
      '/app/inventory' || CASE WHEN cl.batch_number IS NOT NULL THEN '?q=' || cl.batch_number ELSE '' END,
      'lot_expiring:' || cl.lot_id || ':' || tm.recipient_profile_id
    FROM candidate_lots cl CROSS JOIN team_members tm
  ),
  all_rows AS (
    SELECT * FROM task_rows
    UNION ALL
    SELECT * FROM inventory_rows
  ),
  -- A dedup_key collision means this exact (condition, recipient) pair was
  -- already notified at some point. Two cases:
  --  * the existing row is still active (resolved_at IS NULL, whether read
  --    or unread) - the condition never stopped being true, so the WHERE
  --    clause below is false and Postgres leaves the row completely
  --    untouched (same as DO NOTHING): no new row, read_at/updated_at
  --    unaffected, no churn on a plain repeat sync.
  --  * the existing row was resolved - the condition had cleared and has
  --    now recurred, so this is a genuinely new occurrence: reactivate the
  --    same logical row (never insert a second one, dedup_key stays
  --    unique) by clearing resolved_at/read_at and refreshing the
  --    presentation fields and created_at from this occurrence. created_at
  --    is refreshed deliberately: the UI sorts and age-labels by
  --    created_at, and a reactivated alert is a new occurrence from the
  --    user's point of view - leaving the old timestamp would bury a
  --    currently-true alert under unrelated, genuinely older ones.
  inserted AS (
    INSERT INTO notifications (organization_id, program_id, recipient_profile_id, category, severity, title, body, link_path, dedup_key)
    SELECT organization_id, program_id, recipient_profile_id, category, severity, title, body, link_path, dedup_key
    FROM all_rows
    ON CONFLICT (dedup_key) DO UPDATE SET
      program_id = EXCLUDED.program_id,
      severity = EXCLUDED.severity,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      link_path = EXCLUDED.link_path,
      resolved_at = NULL,
      read_at = NULL,
      created_at = now()
    WHERE notifications.resolved_at IS NOT NULL
    RETURNING id
  )
  SELECT array_agg(dedup_key), (SELECT count(*) FROM inserted)
  INTO active_keys, inserted_count
  FROM all_rows;

  WITH resolved AS (
    UPDATE notifications
    SET resolved_at = now()
    WHERE organization_id = target_organization_id
      AND resolved_at IS NULL
      AND category IN ('task_overdue', 'task_due_soon', 'stock_low', 'lot_expiring')
      AND NOT (dedup_key = ANY(COALESCE(active_keys, ARRAY[]::text[])))
    RETURNING id
  )
  SELECT count(*) INTO resolved_count FROM resolved;

  RETURN jsonb_build_object('inserted', inserted_count, 'resolved', resolved_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_notifications_for_team(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_notifications_for_team(UUID) TO authenticated;
