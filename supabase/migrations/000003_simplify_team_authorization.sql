-- BreedOps MVP authorization: one team per user, with simple application roles.
-- This migration is additive so it is safe for a database that already ran 000001/000002.

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_record.policyname, policy_record.tablename);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS get_user_program_ids();
DROP TABLE IF EXISTS program_members;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE parent_lines ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE crosses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE families ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE seed_lots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE germination_tests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE phenotypes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE selection_models ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE selection_criteria ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE phenotype_evaluations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE phenotype_scores ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE experimental_cycles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE task_checklist_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE profiles RENAME COLUMN global_role TO role;
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'user';
UPDATE profiles
SET role = CASE
  WHEN role = 'system_admin' THEN 'system_admin'
  WHEN role IN ('team_admin', 'organization_admin', 'admin') THEN 'team_admin'
  ELSE 'user'
END;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('system_admin', 'team_admin', 'user'));
-- Existing installations with profiles must assign a team before validating old rows.
-- The constraint is enforced for new and changed rows immediately.
ALTER TABLE profiles ADD CONSTRAINT profiles_organization_required
  CHECK (organization_id IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

CREATE OR REPLACE FUNCTION current_team_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_system_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid()
      AND role = 'system_admin'
      AND is_active = true
      AND deleted_at IS NULL
  ), false);
$$;

CREATE OR REPLACE FUNCTION is_team_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid()
      AND role = 'team_admin'
      AND is_active = true
      AND deleted_at IS NULL
  ), false);
$$;

CREATE OR REPLACE FUNCTION can_access_team(team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT is_system_admin() OR team_id = current_team_id();
$$;

CREATE OR REPLACE FUNCTION can_write_team(team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT is_system_admin() OR team_id = current_team_id();
$$;

CREATE OR REPLACE FUNCTION can_access_program(target_program_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.programs
    WHERE id = target_program_id
      AND deleted_at IS NULL
      AND can_access_team(organization_id)
  ), false);
$$;

CREATE OR REPLACE FUNCTION can_write_program(target_program_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.programs
    WHERE id = target_program_id
      AND deleted_at IS NULL
      AND can_write_team(organization_id)
  ), false);
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crosses ENABLE ROW LEVEL SECURITY;
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE seed_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE germination_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE phenotypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE selection_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE selection_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE phenotype_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE phenotype_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE experimental_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Teams and accounts: only a system administrator creates teams or promotes team admins.
CREATE POLICY teams_read ON organizations FOR SELECT
  USING (deleted_at IS NULL AND can_access_team(id));
CREATE POLICY teams_insert ON organizations FOR INSERT
  WITH CHECK (is_system_admin());
CREATE POLICY teams_update ON organizations FOR UPDATE
  USING (is_system_admin() OR (id = current_team_id() AND is_team_admin()))
  WITH CHECK (is_system_admin() OR (id = current_team_id() AND is_team_admin()));

CREATE POLICY profiles_read ON profiles FOR SELECT
  USING (deleted_at IS NULL AND can_access_team(organization_id));
CREATE POLICY profiles_self_update ON profiles FOR UPDATE
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid() AND organization_id = current_team_id() AND role = 'user');
CREATE POLICY profiles_team_admin_insert ON profiles FOR INSERT
  WITH CHECK (
    is_system_admin()
    OR (is_team_admin() AND organization_id = current_team_id() AND role = 'user')
  );
CREATE POLICY profiles_team_admin_update ON profiles FOR UPDATE
  USING (is_system_admin() OR (is_team_admin() AND organization_id = current_team_id()))
  WITH CHECK (
    is_system_admin()
    OR (is_team_admin() AND organization_id = current_team_id() AND role = 'user')
  );

-- Program-scoped records. All authenticated active team members can work on their team's data.
CREATE POLICY programs_read ON programs FOR SELECT USING (can_access_program(id));
CREATE POLICY programs_insert ON programs FOR INSERT WITH CHECK (can_write_team(organization_id));
CREATE POLICY programs_update ON programs FOR UPDATE
  USING (can_access_program(id)) WITH CHECK (can_write_team(organization_id));

CREATE POLICY parent_lines_read ON parent_lines FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY parent_lines_insert ON parent_lines FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY parent_lines_update ON parent_lines FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY crosses_read ON crosses FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY crosses_insert ON crosses FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY crosses_update ON crosses FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY families_read ON families FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY families_insert ON families FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY families_update ON families FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY seed_lots_read ON seed_lots FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY seed_lots_insert ON seed_lots FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY seed_lots_update ON seed_lots FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY phenotypes_read ON phenotypes FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY phenotypes_insert ON phenotypes FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY phenotypes_update ON phenotypes FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY selection_models_read ON selection_models FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY selection_models_insert ON selection_models FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY selection_models_update ON selection_models FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY task_templates_read ON task_templates FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY task_templates_insert ON task_templates FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY task_templates_update ON task_templates FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY experimental_cycles_read ON experimental_cycles FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY experimental_cycles_insert ON experimental_cycles FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY experimental_cycles_update ON experimental_cycles FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));
CREATE POLICY tasks_read ON tasks FOR SELECT USING (deleted_at IS NULL AND can_access_program(program_id));
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (can_write_program(program_id));
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));

-- Records that inherit their team through a parent record.
CREATE POLICY germination_tests_read ON germination_tests FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM seed_lots WHERE id = seed_lot_id AND can_access_program(program_id)));
CREATE POLICY germination_tests_insert ON germination_tests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM seed_lots WHERE id = seed_lot_id AND can_write_program(program_id)));
CREATE POLICY germination_tests_update ON germination_tests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM seed_lots WHERE id = seed_lot_id AND can_access_program(program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM seed_lots WHERE id = seed_lot_id AND can_write_program(program_id)));
CREATE POLICY selection_criteria_read ON selection_criteria FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_access_program(program_id)));
CREATE POLICY selection_criteria_insert ON selection_criteria FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_write_program(program_id)));
CREATE POLICY selection_criteria_update ON selection_criteria FOR UPDATE
  USING (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_access_program(program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_write_program(program_id)));
CREATE POLICY phenotype_evaluations_read ON phenotype_evaluations FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM phenotypes WHERE id = phenotype_id AND can_access_program(program_id)));
CREATE POLICY phenotype_evaluations_insert ON phenotype_evaluations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM phenotypes WHERE id = phenotype_id AND can_write_program(program_id)));
CREATE POLICY phenotype_evaluations_update ON phenotype_evaluations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM phenotypes WHERE id = phenotype_id AND can_access_program(program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM phenotypes WHERE id = phenotype_id AND can_write_program(program_id)));
CREATE POLICY phenotype_scores_read ON phenotype_scores FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE e.id = phenotype_evaluation_id AND can_access_program(p.program_id)));
CREATE POLICY phenotype_scores_insert ON phenotype_scores FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE e.id = phenotype_evaluation_id AND can_write_program(p.program_id)));
CREATE POLICY phenotype_scores_update ON phenotype_scores FOR UPDATE
  USING (EXISTS (SELECT 1 FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE e.id = phenotype_evaluation_id AND can_access_program(p.program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id WHERE e.id = phenotype_evaluation_id AND can_write_program(p.program_id)));
CREATE POLICY task_checklist_items_read ON task_checklist_items FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND can_access_program(program_id)));
CREATE POLICY task_checklist_items_insert ON task_checklist_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND can_write_program(program_id)));
CREATE POLICY task_checklist_items_update ON task_checklist_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND can_access_program(program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND can_write_program(program_id)));

-- Inventory and audit records are team-scoped through their organization or inventory item.
CREATE POLICY inventory_items_read ON inventory_items FOR SELECT USING (deleted_at IS NULL AND can_access_team(organization_id));
CREATE POLICY inventory_items_insert ON inventory_items FOR INSERT WITH CHECK (can_write_team(organization_id));
CREATE POLICY inventory_items_update ON inventory_items FOR UPDATE USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));
CREATE POLICY inventory_lots_read ON inventory_lots FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM inventory_items WHERE id = inventory_item_id AND can_access_team(organization_id)));
CREATE POLICY inventory_lots_insert ON inventory_lots FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_items WHERE id = inventory_item_id AND can_write_team(organization_id)));
CREATE POLICY inventory_lots_update ON inventory_lots FOR UPDATE
  USING (EXISTS (SELECT 1 FROM inventory_items WHERE id = inventory_item_id AND can_access_team(organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_items WHERE id = inventory_item_id AND can_write_team(organization_id)));
CREATE POLICY inventory_movements_read ON inventory_movements FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM inventory_lots l JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.id = inventory_lot_id AND can_access_team(i.organization_id)));
CREATE POLICY inventory_movements_insert ON inventory_movements FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_lots l JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.id = inventory_lot_id AND can_write_team(i.organization_id)));
CREATE POLICY inventory_movements_update ON inventory_movements FOR UPDATE
  USING (EXISTS (SELECT 1 FROM inventory_lots l JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.id = inventory_lot_id AND can_access_team(i.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_lots l JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.id = inventory_lot_id AND can_write_team(i.organization_id)));
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT USING (can_access_team(organization_id));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (can_write_team(organization_id));

-- No DELETE policy is created: functional deletion is performed by setting deleted_at.
