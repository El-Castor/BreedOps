-- Create UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create organizations table
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  global_role TEXT DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create programs table
CREATE TABLE programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  species TEXT,
  campaign TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create program_members table
CREATE TABLE program_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  joined_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Create parent_lines table
CREATE TABLE parent_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  parent_code TEXT UNIQUE NOT NULL,
  line_name TEXT,
  generation INTEGER,
  origin TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create crosses table
CREATE TABLE crosses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  cross_code TEXT UNIQUE NOT NULL,
  female_parent_id UUID REFERENCES parent_lines(id) ON DELETE SET NULL,
  male_parent_id UUID REFERENCES parent_lines(id) ON DELETE SET NULL,
  generation INTEGER,
  target_traits TEXT,
  pollination_date DATE,
  harvest_date DATE,
  pollinated_units INTEGER,
  established_units INTEGER,
  total_seeds INTEGER,
  status TEXT DEFAULT 'active',
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create families table
CREATE TABLE families (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  cross_id UUID REFERENCES crosses(id) ON DELETE CASCADE,
  family_code TEXT UNIQUE NOT NULL,
  generation INTEGER,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create seed_lots table
CREATE TABLE seed_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  cross_id UUID REFERENCES crosses(id) ON DELETE SET NULL,
  family_id UUID REFERENCES families(id) ON DELETE SET NULL,
  seed_lot_code TEXT UNIQUE NOT NULL,
  harvest_date DATE,
  total_quantity NUMERIC,
  quantity_unit TEXT DEFAULT 'seeds',
  storage_location TEXT,
  genetic_purity_status TEXT DEFAULT 'unknown',
  verification_method TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create germination_tests table
CREATE TABLE germination_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seed_lot_id UUID REFERENCES seed_lots(id) ON DELETE CASCADE,
  test_date DATE,
  evaluation_day INTEGER,
  seeds_tested INTEGER,
  seeds_germinated INTEGER,
  germination_rate NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN seeds_tested > 0 THEN (seeds_germinated::NUMERIC * 100) / seeds_tested
      ELSE 0
    END
  ) STORED,
  method TEXT,
  operator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create phenotypes table
CREATE TABLE phenotypes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE,
  seed_lot_id UUID REFERENCES seed_lots(id) ON DELETE SET NULL,
  phenotype_code TEXT UNIQUE NOT NULL,
  block TEXT,
  replicate INTEGER,
  location TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create selection_models table
CREATE TABLE selection_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT DEFAULT '1.0',
  description TEXT,
  maximum_score NUMERIC DEFAULT 130,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create selection_criteria table
CREATE TABLE selection_criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  selection_model_id UUID REFERENCES selection_models(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  coefficient NUMERIC DEFAULT 1,
  minimum_value NUMERIC DEFAULT 0,
  maximum_value NUMERIC DEFAULT 10,
  display_order INTEGER DEFAULT 0,
  is_eliminatory BOOLEAN DEFAULT FALSE,
  eliminatory_threshold NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create phenotype_evaluations table
CREATE TABLE phenotype_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phenotype_id UUID REFERENCES phenotypes(id) ON DELETE CASCADE,
  selection_model_id UUID REFERENCES selection_models(id) ON DELETE CASCADE,
  evaluator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  evaluation_date DATE,
  weighted_score NUMERIC,
  normalized_score NUMERIC,
  automatic_decision TEXT,
  validation_status TEXT DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create phenotype_scores table
CREATE TABLE phenotype_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phenotype_evaluation_id UUID REFERENCES phenotype_evaluations(id) ON DELETE CASCADE,
  criterion_id UUID REFERENCES selection_criteria(id) ON DELETE CASCADE,
  raw_score NUMERIC,
  weighted_value NUMERIC,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create inventory_items table
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT,
  name TEXT NOT NULL,
  cas_number TEXT,
  supplier_reference TEXT,
  default_unit TEXT DEFAULT 'units',
  minimum_stock NUMERIC DEFAULT 0,
  storage_requirements TEXT,
  light_constraints TEXT,
  required_ppe TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create inventory_lots table
CREATE TABLE inventory_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_number TEXT,
  received_at DATE,
  expiration_date DATE,
  initial_quantity NUMERIC DEFAULT 0,
  current_quantity NUMERIC DEFAULT 0,
  storage_location TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create inventory_movements table
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_lot_id UUID REFERENCES inventory_lots(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT DEFAULT 'units',
  movement_date DATE,
  related_program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  related_task_id UUID,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create task_templates table
CREATE TABLE task_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  relative_week INTEGER,
  relative_day INTEGER,
  zone TEXT,
  priority TEXT DEFAULT 'medium',
  sop_code TEXT,
  expected_deliverable TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create experimental_cycles table
CREATE TABLE experimental_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experimental_cycle_id UUID REFERENCES experimental_cycles(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  task_template_id UUID REFERENCES task_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  planned_date DATE,
  due_date DATE,
  completed_at TIMESTAMP,
  zone TEXT,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'not_started',
  sop_code TEXT,
  compliance_status TEXT,
  expected_deliverable TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create task_checklist_items table
CREATE TABLE task_checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_required BOOLEAN DEFAULT TRUE,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT
);

-- Add indexes for better performance
CREATE INDEX idx_programs_organization_id ON programs(organization_id);
CREATE INDEX idx_parent_lines_program_id ON parent_lines(program_id);
CREATE INDEX idx_crosses_program_id ON crosses(program_id);
CREATE INDEX idx_families_program_id ON families(program_id);
CREATE INDEX idx_seed_lots_program_id ON seed_lots(program_id);
CREATE INDEX idx_phenotypes_program_id ON phenotypes(program_id);
CREATE INDEX idx_phenotype_evaluations_phenotype_id ON phenotype_evaluations(phenotype_id);
CREATE INDEX idx_inventory_lots_inventory_item_id ON inventory_lots(inventory_item_id);
CREATE INDEX idx_inventory_movements_inventory_lot_id ON inventory_movements(inventory_lot_id);
CREATE INDEX idx_tasks_program_id ON tasks(program_id);
CREATE INDEX idx_tasks_experimental_cycle_id ON tasks(experimental_cycle_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Add trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_programs_updated_at BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_parent_lines_updated_at BEFORE UPDATE ON parent_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_crosses_updated_at BEFORE UPDATE ON crosses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_families_updated_at BEFORE UPDATE ON families FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_seed_lots_updated_at BEFORE UPDATE ON seed_lots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_germination_tests_updated_at BEFORE UPDATE ON germination_tests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_phenotypes_updated_at BEFORE UPDATE ON phenotypes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_selection_models_updated_at BEFORE UPDATE ON selection_models FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_selection_criteria_updated_at BEFORE UPDATE ON selection_criteria FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_phenotype_evaluations_updated_at BEFORE UPDATE ON phenotype_evaluations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_phenotype_scores_updated_at BEFORE UPDATE ON phenotype_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_lots_updated_at BEFORE UPDATE ON inventory_lots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_movements_updated_at BEFORE UPDATE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_task_templates_updated_at BEFORE UPDATE ON task_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_experimental_cycles_updated_at BEFORE UPDATE ON experimental_cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_task_checklist_items_updated_at BEFORE UPDATE ON task_checklist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_audit_logs_updated_at BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();