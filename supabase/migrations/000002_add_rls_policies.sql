-- Enable Row Level Security on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_members ENABLE ROW LEVEL SECURITY;
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

-- RLS Policies for organizations
CREATE POLICY "Users can view organizations" ON organizations FOR SELECT USING (true);
CREATE POLICY "Users can insert organizations" ON organizations FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update organizations" ON organizations FOR UPDATE USING (true);
CREATE POLICY "Users can delete organizations" ON organizations FOR DELETE USING (true);

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete their own profile" ON profiles FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for programs
CREATE POLICY "Users can view programs in their organization" ON programs FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can insert programs in their organization" ON programs FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can update programs in their organization" ON programs FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can delete programs in their organization" ON programs FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);

-- RLS Policies for program_members
CREATE POLICY "Users can view program members in their programs" ON program_members FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert program members in their programs" ON program_members FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update program members in their programs" ON program_members FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete program members in their programs" ON program_members FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for parent_lines
CREATE POLICY "Users can view parent lines in their programs" ON parent_lines FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert parent lines in their programs" ON parent_lines FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update parent lines in their programs" ON parent_lines FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete parent lines in their programs" ON parent_lines FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for crosses
CREATE POLICY "Users can view crosses in their programs" ON crosses FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert crosses in their programs" ON crosses FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update crosses in their programs" ON crosses FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete crosses in their programs" ON crosses FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for families
CREATE POLICY "Users can view families in their programs" ON families FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert families in their programs" ON families FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update families in their programs" ON families FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete families in their programs" ON families FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for seed_lots
CREATE POLICY "Users can view seed lots in their programs" ON seed_lots FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert seed lots in their programs" ON seed_lots FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update seed lots in their programs" ON seed_lots FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete seed lots in their programs" ON seed_lots FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for germination_tests
CREATE POLICY "Users can view germination tests in their programs" ON germination_tests FOR SELECT USING (
  seed_lot_id IN (
    SELECT id FROM seed_lots WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can insert germination tests in their programs" ON germination_tests FOR INSERT WITH CHECK (
  seed_lot_id IN (
    SELECT id FROM seed_lots WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can update germination tests in their programs" ON germination_tests FOR UPDATE USING (
  seed_lot_id IN (
    SELECT id FROM seed_lots WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can delete germination tests in their programs" ON germination_tests FOR DELETE USING (
  seed_lot_id IN (
    SELECT id FROM seed_lots WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);

-- RLS Policies for phenotypes
CREATE POLICY "Users can view phenotypes in their programs" ON phenotypes FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert phenotypes in their programs" ON phenotypes FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update phenotypes in their programs" ON phenotypes FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete phenotypes in their programs" ON phenotypes FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for selection_models
CREATE POLICY "Users can view selection models in their programs" ON selection_models FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert selection models in their programs" ON selection_models FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update selection models in their programs" ON selection_models FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete selection models in their programs" ON selection_models FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for selection_criteria
CREATE POLICY "Users can view selection criteria in their programs" ON selection_criteria FOR SELECT USING (
  selection_model_id IN (
    SELECT id FROM selection_models WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can insert selection criteria in their programs" ON selection_criteria FOR INSERT WITH CHECK (
  selection_model_id IN (
    SELECT id FROM selection_models WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can update selection criteria in their programs" ON selection_criteria FOR UPDATE USING (
  selection_model_id IN (
    SELECT id FROM selection_models WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can delete selection criteria in their programs" ON selection_criteria FOR DELETE USING (
  selection_model_id IN (
    SELECT id FROM selection_models WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);

-- RLS Policies for phenotype_evaluations
CREATE POLICY "Users can view phenotype evaluations in their programs" ON phenotype_evaluations FOR SELECT USING (
  phenotype_id IN (
    SELECT id FROM phenotypes WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can insert phenotype evaluations in their programs" ON phenotype_evaluations FOR INSERT WITH CHECK (
  phenotype_id IN (
    SELECT id FROM phenotypes WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can update phenotype evaluations in their programs" ON phenotype_evaluations FOR UPDATE USING (
  phenotype_id IN (
    SELECT id FROM phenotypes WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can delete phenotype evaluations in their programs" ON phenotype_evaluations FOR DELETE USING (
  phenotype_id IN (
    SELECT id FROM phenotypes WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);

-- RLS Policies for phenotype_scores
CREATE POLICY "Users can view phenotype scores in their programs" ON phenotype_scores FOR SELECT USING (
  phenotype_evaluation_id IN (
    SELECT id FROM phenotype_evaluations WHERE phenotype_id IN (
      SELECT id FROM phenotypes WHERE program_id IN (
        SELECT program_id FROM programs WHERE organization_id IN (
          SELECT organization_id FROM profiles WHERE user_id = auth.uid()
        )
      )
    )
  )
);
CREATE POLICY "Users can insert phenotype scores in their programs" ON phenotype_scores FOR INSERT WITH CHECK (
  phenotype_evaluation_id IN (
    SELECT id FROM phenotype_evaluations WHERE phenotype_id IN (
      SELECT id FROM phenotypes WHERE program_id IN (
        SELECT program_id FROM programs WHERE organization_id IN (
          SELECT organization_id FROM profiles WHERE user_id = auth.uid()
        )
      )
    )
  )
);
CREATE POLICY "Users can update phenotype scores in their programs" ON phenotype_scores FOR UPDATE USING (
  phenotype_evaluation_id IN (
    SELECT id FROM phenotype_evaluations WHERE phenotype_id IN (
      SELECT id FROM phenotypes WHERE program_id IN (
        SELECT program_id FROM programs WHERE organization_id IN (
          SELECT organization_id FROM profiles WHERE user_id = auth.uid()
        )
      )
    )
  )
);
CREATE POLICY "Users can delete phenotype scores in their programs" ON phenotype_scores FOR DELETE USING (
  phenotype_evaluation_id IN (
    SELECT id FROM phenotype_evaluations WHERE phenotype_id IN (
      SELECT id FROM phenotypes WHERE program_id IN (
        SELECT program_id FROM programs WHERE organization_id IN (
          SELECT organization_id FROM profiles WHERE user_id = auth.uid()
        )
      )
    )
  )
);

-- RLS Policies for inventory_items
CREATE POLICY "Users can view inventory items in their organization" ON inventory_items FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can insert inventory items in their organization" ON inventory_items FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can update inventory items in their organization" ON inventory_items FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can delete inventory items in their organization" ON inventory_items FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);

-- RLS Policies for inventory_lots
CREATE POLICY "Users can view inventory lots in their organization" ON inventory_lots FOR SELECT USING (
  inventory_item_id IN (
    SELECT id FROM inventory_items WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert inventory lots in their organization" ON inventory_lots FOR INSERT WITH CHECK (
  inventory_item_id IN (
    SELECT id FROM inventory_items WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update inventory lots in their organization" ON inventory_lots FOR UPDATE USING (
  inventory_item_id IN (
    SELECT id FROM inventory_items WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete inventory lots in their organization" ON inventory_lots FOR DELETE USING (
  inventory_item_id IN (
    SELECT id FROM inventory_items WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for inventory_movements
CREATE POLICY "Users can view inventory movements in their organization" ON inventory_movements FOR SELECT USING (
  inventory_lot_id IN (
    SELECT id FROM inventory_lots WHERE inventory_item_id IN (
      SELECT id FROM inventory_items WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can insert inventory movements in their organization" ON inventory_movements FOR INSERT WITH CHECK (
  inventory_lot_id IN (
    SELECT id FROM inventory_lots WHERE inventory_item_id IN (
      SELECT id FROM inventory_items WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can update inventory movements in their organization" ON inventory_movements FOR UPDATE USING (
  inventory_lot_id IN (
    SELECT id FROM inventory_lots WHERE inventory_item_id IN (
      SELECT id FROM inventory_items WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can delete inventory movements in their organization" ON inventory_movements FOR DELETE USING (
  inventory_lot_id IN (
    SELECT id FROM inventory_lots WHERE inventory_item_id IN (
      SELECT id FROM inventory_items WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);

-- RLS Policies for task_templates
CREATE POLICY "Users can view task templates in their programs" ON task_templates FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert task templates in their programs" ON task_templates FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update task templates in their programs" ON task_templates FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete task templates in their programs" ON task_templates FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for experimental_cycles
CREATE POLICY "Users can view experimental cycles in their programs" ON experimental_cycles FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert experimental cycles in their programs" ON experimental_cycles FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update experimental cycles in their programs" ON experimental_cycles FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete experimental cycles in their programs" ON experimental_cycles FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for tasks
CREATE POLICY "Users can view tasks in their programs" ON tasks FOR SELECT USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can insert tasks in their programs" ON tasks FOR INSERT WITH CHECK (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can update tasks in their programs" ON tasks FOR UPDATE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "Users can delete tasks in their programs" ON tasks FOR DELETE USING (
  program_id IN (
    SELECT program_id FROM programs WHERE organization_id IN (
      SELECT organization_id FROM profiles WHERE user_id = auth.uid()
    )
  )
);

-- RLS Policies for task_checklist_items
CREATE POLICY "Users can view task checklist items in their programs" ON task_checklist_items FOR SELECT USING (
  task_id IN (
    SELECT id FROM tasks WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can insert task checklist items in their programs" ON task_checklist_items FOR INSERT WITH CHECK (
  task_id IN (
    SELECT id FROM tasks WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can update task checklist items in their programs" ON task_checklist_items FOR UPDATE USING (
  task_id IN (
    SELECT id FROM tasks WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "Users can delete task checklist items in their programs" ON task_checklist_items FOR DELETE USING (
  task_id IN (
    SELECT id FROM tasks WHERE program_id IN (
      SELECT program_id FROM programs WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  )
);

-- RLS Policies for audit_logs
CREATE POLICY "Users can view audit logs in their organization" ON audit_logs FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can insert audit logs in their organization" ON audit_logs FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can update audit logs in their organization" ON audit_logs FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);
CREATE POLICY "Users can delete audit logs in their organization" ON audit_logs FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE user_id = auth.uid()
  )
);

-- Create function to get user's organization ID
CREATE OR REPLACE FUNCTION get_user_organization_id()
RETURNS UUID AS $$
  SELECT organization_id FROM profiles WHERE user_id = auth.uid()
$$ LANGUAGE SQL STABLE;

-- Create function to get user's program IDs
CREATE OR REPLACE FUNCTION get_user_program_ids()
RETURNS SETOF UUID AS $$
  SELECT program_id FROM program_members WHERE user_id = auth.uid() AND is_active = true
$$ LANGUAGE SQL STABLE;