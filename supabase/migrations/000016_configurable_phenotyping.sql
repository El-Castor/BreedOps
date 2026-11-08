-- Configurable phenotyping: team trait library, reusable modules, per-program
-- module selection, typed trait observations and trait-linked selection weights.
-- Additive: existing models, criteria, rules, evaluations and scores are kept and
-- the fixed V1 criteria are mapped into the trait library.

-- ───────────────────────── Trait library ─────────────────────────
CREATE TABLE public.phenotype_traits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_]{0,59}$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
    'morphology', 'development', 'flowering', 'yield', 'quality',
    'disease_resistance', 'stress_tolerance', 'seed', 'physiology',
    'architecture', 'other')),
  data_type TEXT NOT NULL CHECK (data_type IN (
    'numeric', 'integer', 'ordinal', 'categorical', 'boolean', 'date', 'text')),
  unit TEXT CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 30),
  minimum_value NUMERIC,
  maximum_value NUMERIC,
  decimal_places INTEGER CHECK (decimal_places IS NULL OR decimal_places BETWEEN 0 AND 6),
  allowed_values TEXT[],
  direction TEXT NOT NULL DEFAULT 'neutral' CHECK (direction IN (
    'higher_is_better', 'lower_is_better', 'target_value', 'neutral')),
  target_value NUMERIC,
  protocol TEXT CHECK (protocol IS NULL OR char_length(protocol) <= 2000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT phenotype_traits_code_unique UNIQUE (organization_id, code),
  CONSTRAINT phenotype_traits_bounds CHECK (
    minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value),
  CONSTRAINT phenotype_traits_range_types CHECK (
    data_type IN ('numeric', 'integer', 'ordinal')
    OR (minimum_value IS NULL AND maximum_value IS NULL AND decimal_places IS NULL)),
  CONSTRAINT phenotype_traits_ordinal_scale CHECK (
    data_type <> 'ordinal' OR (
      minimum_value IS NOT NULL AND maximum_value IS NOT NULL
      AND minimum_value = trunc(minimum_value) AND maximum_value = trunc(maximum_value))),
  CONSTRAINT phenotype_traits_categories CHECK (
    (data_type = 'categorical') = (allowed_values IS NOT NULL)
    AND (allowed_values IS NULL OR cardinality(allowed_values) BETWEEN 2 AND 50)),
  CONSTRAINT phenotype_traits_target CHECK (
    (direction = 'target_value') = (target_value IS NOT NULL)
    AND (target_value IS NULL OR data_type IN ('numeric', 'integer', 'ordinal')))
);
COMMENT ON TABLE public.phenotype_traits IS
  'Team-scoped trait definitions; programs observe them through phenotyping modules.';
COMMENT ON COLUMN public.phenotype_traits.direction IS
  'Desirability for selection; neutral for purely observational traits.';

CREATE TABLE public.phenotyping_modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT phenotyping_modules_name_unique UNIQUE (organization_id, name)
);

CREATE TABLE public.phenotyping_module_traits (
  module_id UUID NOT NULL REFERENCES public.phenotyping_modules(id) ON DELETE CASCADE,
  trait_id UUID NOT NULL REFERENCES public.phenotype_traits(id),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (module_id, trait_id)
);
CREATE INDEX phenotyping_module_traits_trait_idx ON public.phenotyping_module_traits(trait_id);

CREATE TABLE public.program_phenotyping_modules (
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.phenotyping_modules(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (program_id, module_id)
);
CREATE INDEX program_phenotyping_modules_module_idx ON public.program_phenotyping_modules(module_id);

-- One typed value per trait and evaluation; exactly one value column is set.
CREATE TABLE public.phenotype_trait_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phenotype_evaluation_id UUID NOT NULL REFERENCES public.phenotype_evaluations(id) ON DELETE CASCADE,
  trait_id UUID NOT NULL REFERENCES public.phenotype_traits(id),
  numeric_value NUMERIC,
  text_value TEXT CHECK (text_value IS NULL OR char_length(text_value) BETWEEN 1 AND 1000),
  boolean_value BOOLEAN,
  date_value DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT phenotype_trait_values_unique UNIQUE (phenotype_evaluation_id, trait_id),
  CONSTRAINT phenotype_trait_values_one_value CHECK (num_nonnulls(
    numeric_value, text_value, boolean_value, date_value) = 1)
);
CREATE INDEX phenotype_trait_values_trait_idx ON public.phenotype_trait_values(trait_id);

-- Selection criteria now reference the trait they weight.
ALTER TABLE public.selection_criteria
  ADD COLUMN trait_id UUID REFERENCES public.phenotype_traits(id);
CREATE INDEX selection_criteria_trait_idx ON public.selection_criteria(trait_id);
-- Observation-only evaluations (no complete weighted model) carry no model.
ALTER TABLE public.phenotype_evaluations ALTER COLUMN selection_model_id DROP NOT NULL;

CREATE TRIGGER update_phenotype_traits_updated_at BEFORE UPDATE ON public.phenotype_traits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_phenotyping_modules_updated_at BEFORE UPDATE ON public.phenotyping_modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_program_phenotyping_modules_updated_at BEFORE UPDATE ON public.program_phenotyping_modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Cross-team composition is rejected in PostgreSQL, not only in the UI.
CREATE FUNCTION public.validate_phenotyping_composition()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'phenotyping_module_traits' THEN
    IF NOT EXISTS (SELECT 1 FROM phenotyping_modules m JOIN phenotype_traits t
      ON t.organization_id = m.organization_id
      WHERE m.id = NEW.module_id AND t.id = NEW.trait_id) THEN
      RAISE EXCEPTION 'Module and trait must belong to the same team' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM phenotyping_modules m JOIN programs p
      ON p.organization_id = m.organization_id
      WHERE m.id = NEW.module_id AND p.id = NEW.program_id) THEN
    RAISE EXCEPTION 'Program and module must belong to the same team' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_phenotyping_composition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_module_trait_team BEFORE INSERT OR UPDATE OF module_id, trait_id
  ON public.phenotyping_module_traits FOR EACH ROW EXECUTE FUNCTION public.validate_phenotyping_composition();
CREATE TRIGGER validate_program_module_team BEFORE INSERT OR UPDATE OF program_id, module_id
  ON public.program_phenotyping_modules FOR EACH ROW EXECUTE FUNCTION public.validate_phenotyping_composition();

-- ───────────────────────── RLS ─────────────────────────
ALTER TABLE public.phenotype_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phenotyping_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phenotyping_module_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_phenotyping_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phenotype_trait_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY phenotype_traits_read ON public.phenotype_traits FOR SELECT
  USING (can_access_team(organization_id));
CREATE POLICY phenotype_traits_insert ON public.phenotype_traits FOR INSERT
  WITH CHECK (can_write_team(organization_id));
CREATE POLICY phenotype_traits_update ON public.phenotype_traits FOR UPDATE
  USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));

CREATE POLICY phenotyping_modules_read ON public.phenotyping_modules FOR SELECT
  USING (can_access_team(organization_id));
CREATE POLICY phenotyping_modules_insert ON public.phenotyping_modules FOR INSERT
  WITH CHECK (can_write_team(organization_id));
CREATE POLICY phenotyping_modules_update ON public.phenotyping_modules FOR UPDATE
  USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));

CREATE POLICY phenotyping_module_traits_read ON public.phenotyping_module_traits FOR SELECT
  USING (EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = module_id AND can_access_team(m.organization_id)));
CREATE POLICY phenotyping_module_traits_insert ON public.phenotyping_module_traits FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = module_id AND can_write_team(m.organization_id)));
CREATE POLICY phenotyping_module_traits_update ON public.phenotyping_module_traits FOR UPDATE
  USING (EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = module_id AND can_access_team(m.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = module_id AND can_write_team(m.organization_id)));
-- Removing a trait from a module only changes composition; observations keep the trait.
CREATE POLICY phenotyping_module_traits_delete ON public.phenotyping_module_traits FOR DELETE
  USING (EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = module_id AND can_write_team(m.organization_id)));

CREATE POLICY program_phenotyping_modules_read ON public.program_phenotyping_modules FOR SELECT
  USING (can_access_program(program_id));
CREATE POLICY program_phenotyping_modules_insert ON public.program_phenotyping_modules FOR INSERT
  WITH CHECK (can_write_program(program_id));
CREATE POLICY program_phenotyping_modules_update ON public.program_phenotyping_modules FOR UPDATE
  USING (can_access_program(program_id)) WITH CHECK (can_write_program(program_id));

-- Values are written only through submit_trait_evaluation (no direct insert policy).
CREATE POLICY phenotype_trait_values_read ON public.phenotype_trait_values FOR SELECT
  USING (EXISTS (SELECT 1 FROM phenotype_evaluations e JOIN phenotypes p ON p.id = e.phenotype_id
    WHERE e.id = phenotype_evaluation_id AND can_access_program(p.program_id)));

-- ───────────────────────── Program traits ─────────────────────────
-- Active traits of a program: active modules, active traits, first module wins.
CREATE FUNCTION public.program_active_traits(target_program_id UUID)
RETURNS TABLE (
  trait_id UUID, code TEXT, name TEXT, description TEXT, category TEXT,
  data_type TEXT, unit TEXT, minimum_value NUMERIC, maximum_value NUMERIC,
  decimal_places INTEGER, allowed_values TEXT[], direction TEXT,
  target_value NUMERIC, protocol TEXT, module_id UUID, module_name TEXT,
  module_order INTEGER, trait_order INTEGER, coefficient NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH ranked AS (
    SELECT DISTINCT ON (t.id)
      t.id, t.code, t.name, t.description, t.category, t.data_type, t.unit,
      t.minimum_value, t.maximum_value, t.decimal_places, t.allowed_values,
      t.direction, t.target_value, t.protocol, m.id AS module_id,
      m.name AS module_name, pm.display_order AS module_order,
      mt.display_order AS trait_order
    FROM program_phenotyping_modules pm
    JOIN phenotyping_modules m ON m.id = pm.module_id AND m.is_active
    JOIN phenotyping_module_traits mt ON mt.module_id = m.id
    JOIN phenotype_traits t ON t.id = mt.trait_id AND t.is_active
    WHERE pm.program_id = target_program_id AND pm.is_active
    ORDER BY t.id, pm.display_order, m.name, mt.display_order
  )
  SELECT r.*, (
    SELECT c.coefficient FROM selection_criteria c
    JOIN selection_models sm ON sm.id = c.selection_model_id
    WHERE c.trait_id = r.id AND c.deleted_at IS NULL AND sm.program_id = target_program_id
      AND sm.is_active AND sm.deleted_at IS NULL
    ORDER BY sm.created_at LIMIT 1)
  FROM ranked r
  ORDER BY r.module_order, r.module_name, r.trait_order;
$$;
REVOKE ALL ON FUNCTION public.program_active_traits(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_active_traits(UUID) TO authenticated;

-- ───────────────────────── Dynamic evaluation ─────────────────────────
-- Validates every submitted value against trait metadata. The evaluation is
-- scored by the existing model only when every weighted criterion has a value;
-- otherwise it is stored as an observation-only evaluation. SECURITY DEFINER
-- because typed values have no direct insert policy: this function is their only
-- writer. Every read is scoped to the phenotype's program after the explicit
-- can_write_program / auth.uid() checks below.
CREATE FUNCTION public.submit_trait_evaluation(
  target_phenotype_id UUID, target_date DATE, submitted_values JSONB,
  evaluation_notes TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_program UUID;
  evaluation_id UUID;
  model_id UUID;
  key TEXT;
  raw JSONB;
  value_number NUMERIC;
  supplied INTEGER := 0;
  trait RECORD;
BEGIN
  SELECT p.program_id INTO target_program FROM phenotypes p
  WHERE p.id = target_phenotype_id AND p.deleted_at IS NULL AND can_write_program(p.program_id);
  IF target_program IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF target_date IS NULL OR jsonb_typeof(submitted_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid evaluation payload' USING ERRCODE = '22023';
  END IF;
  IF evaluation_notes IS NOT NULL AND char_length(evaluation_notes) > 1000 THEN
    RAISE EXCEPTION 'Notes too long' USING ERRCODE = '22023';
  END IF;
  FOR key IN SELECT jsonb_object_keys(submitted_values) LOOP
    IF NOT EXISTS (SELECT 1 FROM program_active_traits(target_program) t WHERE t.code = key) THEN
      RAISE EXCEPTION 'Trait % is not active for this program', key USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT m.id INTO model_id FROM selection_models m
  WHERE m.program_id = target_program AND m.is_active AND m.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM selection_criteria c
      WHERE c.selection_model_id = m.id AND c.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM selection_criteria c
      LEFT JOIN phenotype_traits t ON t.id = c.trait_id
      WHERE c.selection_model_id = m.id AND c.deleted_at IS NULL
        AND CASE
          WHEN t.id IS NULL THEN TRUE
          WHEN jsonb_typeof(submitted_values -> t.code) IS DISTINCT FROM 'number' THEN TRUE
          ELSE (submitted_values ->> t.code)::NUMERIC NOT BETWEEN c.minimum_value AND c.maximum_value
        END)
  ORDER BY m.created_at LIMIT 1;

  INSERT INTO phenotype_evaluations(
    phenotype_id, selection_model_id, evaluator_id, evaluation_date, validation_status, notes)
  SELECT target_phenotype_id, model_id, pr.id, target_date, 'draft', NULLIF(btrim(evaluation_notes), '')
  FROM profiles pr WHERE pr.user_id = auth.uid() AND pr.is_active AND pr.deleted_at IS NULL
  RETURNING id INTO evaluation_id;
  IF evaluation_id IS NULL THEN
    RAISE EXCEPTION 'Active evaluator required' USING ERRCODE = '42501';
  END IF;

  FOR trait IN SELECT * FROM program_active_traits(target_program) LOOP
    raw := submitted_values -> trait.code;
    CONTINUE WHEN raw IS NULL OR raw = 'null'::JSONB;
    supplied := supplied + 1;
    IF trait.data_type IN ('numeric', 'integer', 'ordinal') THEN
      IF jsonb_typeof(raw) <> 'number' THEN
        RAISE EXCEPTION 'Invalid value for %', trait.code USING ERRCODE = '22023';
      END IF;
      value_number := (raw #>> '{}')::NUMERIC;
      IF trait.data_type <> 'numeric' AND value_number <> trunc(value_number) THEN
        RAISE EXCEPTION 'Whole number required for %', trait.code USING ERRCODE = '22023';
      END IF;
      IF (trait.minimum_value IS NOT NULL AND value_number < trait.minimum_value)
        OR (trait.maximum_value IS NOT NULL AND value_number > trait.maximum_value) THEN
        RAISE EXCEPTION 'Value outside bounds for %', trait.code USING ERRCODE = '23514';
      END IF;
      IF trait.decimal_places IS NOT NULL AND value_number <> round(value_number, trait.decimal_places) THEN
        RAISE EXCEPTION 'Too many decimals for %', trait.code USING ERRCODE = '22023';
      END IF;
      INSERT INTO phenotype_trait_values(phenotype_evaluation_id, trait_id, numeric_value)
      VALUES (evaluation_id, trait.trait_id, value_number);
    ELSIF trait.data_type = 'boolean' THEN
      IF jsonb_typeof(raw) <> 'boolean' THEN
        RAISE EXCEPTION 'Invalid value for %', trait.code USING ERRCODE = '22023';
      END IF;
      INSERT INTO phenotype_trait_values(phenotype_evaluation_id, trait_id, boolean_value)
      VALUES (evaluation_id, trait.trait_id, (raw #>> '{}')::BOOLEAN);
    ELSIF trait.data_type = 'date' THEN
      IF jsonb_typeof(raw) <> 'string' OR (raw #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Invalid date for %', trait.code USING ERRCODE = '22023';
      END IF;
      INSERT INTO phenotype_trait_values(phenotype_evaluation_id, trait_id, date_value)
      VALUES (evaluation_id, trait.trait_id, (raw #>> '{}')::DATE);
    ELSIF trait.data_type = 'categorical' THEN
      IF jsonb_typeof(raw) <> 'string' OR NOT ((raw #>> '{}') = ANY (trait.allowed_values)) THEN
        RAISE EXCEPTION 'Value not allowed for %', trait.code USING ERRCODE = '23514';
      END IF;
      INSERT INTO phenotype_trait_values(phenotype_evaluation_id, trait_id, text_value)
      VALUES (evaluation_id, trait.trait_id, raw #>> '{}');
    ELSE
      IF jsonb_typeof(raw) <> 'string' OR char_length(btrim(raw #>> '{}')) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Invalid text for %', trait.code USING ERRCODE = '22023';
      END IF;
      INSERT INTO phenotype_trait_values(phenotype_evaluation_id, trait_id, text_value)
      VALUES (evaluation_id, trait.trait_id, btrim(raw #>> '{}'));
    END IF;
  END LOOP;
  IF supplied = 0 THEN
    RAISE EXCEPTION 'At least one trait value is required' USING ERRCODE = '23514';
  END IF;

  -- Existing scoring path: scores feed refresh_phenotype_evaluation.
  IF model_id IS NOT NULL THEN
    INSERT INTO phenotype_scores(phenotype_evaluation_id, criterion_id, raw_score)
    SELECT evaluation_id, c.id, (submitted_values ->> t.code)::NUMERIC
    FROM selection_criteria c JOIN phenotype_traits t ON t.id = c.trait_id
    WHERE c.selection_model_id = model_id AND c.deleted_at IS NULL;
  END IF;
  RETURN evaluation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_trait_evaluation(UUID, DATE, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_trait_evaluation(UUID, DATE, JSONB, TEXT) TO authenticated;

-- Weight (or unweight) one active, numeric-scale trait in the program's model.
CREATE FUNCTION public.set_program_trait_weight(
  target_program_id UUID, target_trait_id UUID, new_coefficient NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  model_id UUID;
  trait RECORD;
  criterion_id UUID;
  new_maximum NUMERIC;
BEGIN
  IF NOT can_write_program(target_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF new_coefficient IS NOT NULL AND (new_coefficient <= 0 OR new_coefficient > 100) THEN
    RAISE EXCEPTION 'Invalid coefficient' USING ERRCODE = '22023';
  END IF;
  SELECT m.id INTO model_id FROM selection_models m
  WHERE m.program_id = target_program_id AND m.is_active AND m.deleted_at IS NULL
  ORDER BY m.created_at LIMIT 1;
  IF model_id IS NULL THEN
    RAISE EXCEPTION 'An active selection model is required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO trait FROM program_active_traits(target_program_id) t
  WHERE t.trait_id = target_trait_id;
  IF trait.trait_id IS NULL THEN
    RAISE EXCEPTION 'Trait is not active for this program' USING ERRCODE = '23514';
  END IF;
  IF new_coefficient IS NOT NULL AND (trait.data_type NOT IN ('numeric', 'integer', 'ordinal')
      OR trait.minimum_value IS NULL OR trait.maximum_value IS NULL) THEN
    RAISE EXCEPTION 'Only bounded numeric traits can be weighted' USING ERRCODE = '23514';
  END IF;

  SELECT c.id INTO criterion_id FROM selection_criteria c
  WHERE c.selection_model_id = model_id AND (c.trait_id = target_trait_id OR c.code = trait.code)
  ORDER BY (c.trait_id = target_trait_id) DESC NULLS LAST LIMIT 1;

  IF new_coefficient IS NULL THEN
    UPDATE selection_criteria SET deleted_at = NOW() WHERE id = criterion_id;
  ELSIF criterion_id IS NULL THEN
    INSERT INTO selection_criteria(selection_model_id, trait_id, code, name, coefficient,
      minimum_value, maximum_value, display_order)
    SELECT model_id, trait.trait_id, trait.code, trait.name, new_coefficient,
      trait.minimum_value, trait.maximum_value,
      COALESCE(MAX(display_order), 0) + 1
    FROM selection_criteria WHERE selection_model_id = model_id;
  ELSE
    UPDATE selection_criteria SET trait_id = trait.trait_id, coefficient = new_coefficient,
      minimum_value = trait.minimum_value, maximum_value = trait.maximum_value, deleted_at = NULL
    WHERE id = criterion_id;
  END IF;

  SELECT SUM(maximum_value * coefficient) INTO new_maximum FROM selection_criteria
  WHERE selection_model_id = model_id AND deleted_at IS NULL;
  IF new_maximum IS NULL OR new_maximum <= 0 THEN
    RAISE EXCEPTION 'A selection model needs at least one weighted trait' USING ERRCODE = '23514';
  END IF;
  UPDATE selection_models SET maximum_score = new_maximum WHERE id = model_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_program_trait_weight(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_program_trait_weight(UUID, UUID, NUMERIC) TO authenticated;

-- Swap a trait with its neighbour in a module (up = -1, down = 1).
CREATE FUNCTION public.move_module_trait(target_module_id UUID, target_trait_id UUID, step INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  current_order INTEGER;
  neighbour RECORD;
BEGIN
  IF step NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Invalid step' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM phenotyping_modules m
    WHERE m.id = target_module_id AND can_write_team(m.organization_id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT display_order INTO current_order FROM phenotyping_module_traits
  WHERE module_id = target_module_id AND trait_id = target_trait_id;
  IF current_order IS NULL THEN
    RAISE EXCEPTION 'Trait not in module' USING ERRCODE = '23514';
  END IF;
  SELECT trait_id, display_order INTO neighbour FROM phenotyping_module_traits
  WHERE module_id = target_module_id
    AND CASE WHEN step < 0 THEN display_order < current_order ELSE display_order > current_order END
  ORDER BY CASE WHEN step < 0 THEN -display_order ELSE display_order END
  LIMIT 1;
  IF neighbour.trait_id IS NULL THEN RETURN; END IF;
  UPDATE phenotyping_module_traits SET display_order = neighbour.display_order
  WHERE module_id = target_module_id AND trait_id = target_trait_id;
  UPDATE phenotyping_module_traits SET display_order = current_order
  WHERE module_id = target_module_id AND trait_id = neighbour.trait_id;
END;
$$;
REVOKE ALL ON FUNCTION public.move_module_trait(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_module_trait(UUID, UUID, INTEGER) TO authenticated;

-- ───────────────────────── V1 criteria as library traits ─────────────────────────
CREATE FUNCTION public.v1_trait_category(criterion_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE criterion_code
    WHEN 'vigor' THEN 'development'
    WHEN 'architecture' THEN 'architecture'
    WHEN 'yield' THEN 'yield'
    WHEN 'sanitary_quality' THEN 'disease_resistance'
    WHEN 'analytical_quality' THEN 'quality'
    ELSE 'other'
  END;
$$;

-- New initial models create/reuse the V1 library traits, link their criteria
-- and activate a "Sélection V1" module for the program.
CREATE OR REPLACE FUNCTION public.create_initial_selection_model(target_program_id uuid, model_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  model_id uuid;
  team_id uuid;
  v1_module uuid;
BEGIN
  IF NOT can_write_program(target_program_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF length(trim(model_name)) < 1 OR length(model_name) > 160 THEN RAISE EXCEPTION 'Invalid model name' USING ERRCODE = '22023'; END IF;
  SELECT organization_id INTO team_id FROM programs WHERE id = target_program_id;
  INSERT INTO selection_models(program_id,name,version,maximum_score,is_active)
  VALUES(target_program_id,trim(model_name),'1.0',130,true) RETURNING id INTO model_id;
  INSERT INTO selection_criteria(selection_model_id,code,name,coefficient,minimum_value,maximum_value,display_order) VALUES
    (model_id,'vigor','Vigueur',1,0,10,1),(model_id,'architecture','Architecture',1,0,10,2),
    (model_id,'yield','Rendement',2,0,10,3),(model_id,'sanitary_quality','Qualité sanitaire',2,0,10,4),
    (model_id,'analytical_quality','Qualité analytique',3,0,10,5),(model_id,'stability','Stabilité',4,0,10,6);
  INSERT INTO selection_decision_rules(selection_model_id,decision,minimum_weighted_score,minimum_stability_score,display_order) VALUES
    (model_id,'elite',110,9,1),(model_id,'advance',100,8,2),(model_id,'reserve',90,7,3),(model_id,'eliminate',0,0,4);

  INSERT INTO phenotype_traits(organization_id, code, name, category, data_type,
    minimum_value, maximum_value, decimal_places, direction)
  SELECT team_id, c.code, c.name, v1_trait_category(c.code), 'numeric',
    c.minimum_value, c.maximum_value, 1, 'higher_is_better'
  FROM selection_criteria c WHERE c.selection_model_id = model_id
  ON CONFLICT (organization_id, code) DO NOTHING;
  UPDATE selection_criteria c SET trait_id = t.id FROM phenotype_traits t
  WHERE c.selection_model_id = model_id AND t.organization_id = team_id AND t.code = c.code;

  INSERT INTO phenotyping_modules(organization_id, name, description)
  VALUES (team_id, 'Sélection V1', 'Six critères notés de 0 à 10 du modèle de sélection initial.')
  ON CONFLICT (organization_id, name) DO NOTHING;
  SELECT id INTO v1_module FROM phenotyping_modules WHERE organization_id = team_id AND name = 'Sélection V1';
  INSERT INTO phenotyping_module_traits(module_id, trait_id, display_order)
  SELECT v1_module, c.trait_id, c.display_order FROM selection_criteria c
  WHERE c.selection_model_id = model_id
  ON CONFLICT DO NOTHING;
  INSERT INTO program_phenotyping_modules(program_id, module_id, is_active)
  VALUES (target_program_id, v1_module, TRUE)
  ON CONFLICT (program_id, module_id) DO UPDATE SET is_active = TRUE;
  RETURN model_id;
END;
$$;

-- ───────────────────────── Historical data mapping ─────────────────────────
-- Every existing criterion becomes (or reuses) a team trait with the same code;
-- criteria, scores, rules and evaluations are kept and linked, not rewritten.
INSERT INTO public.phenotype_traits(organization_id, code, name, category, data_type,
  minimum_value, maximum_value, decimal_places, direction)
SELECT DISTINCT ON (p.organization_id, c.code)
  p.organization_id, c.code, c.name, public.v1_trait_category(c.code), 'numeric',
  c.minimum_value, c.maximum_value, 1, 'higher_is_better'
FROM public.selection_criteria c
JOIN public.selection_models m ON m.id = c.selection_model_id
JOIN public.programs p ON p.id = m.program_id
ORDER BY p.organization_id, c.code, c.created_at
ON CONFLICT (organization_id, code) DO NOTHING;

UPDATE public.selection_criteria c SET trait_id = t.id
FROM public.selection_models m, public.programs p, public.phenotype_traits t
WHERE m.id = c.selection_model_id AND p.id = m.program_id
  AND t.organization_id = p.organization_id AND t.code = c.code AND c.trait_id IS NULL;

INSERT INTO public.phenotyping_modules(organization_id, name, description)
SELECT DISTINCT p.organization_id, 'Sélection V1',
  'Critères du modèle de sélection initial, migrés dans la bibliothèque de traits.'
FROM public.selection_models m JOIN public.programs p ON p.id = m.program_id
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.phenotyping_module_traits(module_id, trait_id, display_order)
SELECT DISTINCT ON (mod.id, c.trait_id) mod.id, c.trait_id, c.display_order
FROM public.selection_criteria c
JOIN public.selection_models m ON m.id = c.selection_model_id
JOIN public.programs p ON p.id = m.program_id
JOIN public.phenotyping_modules mod ON mod.organization_id = p.organization_id AND mod.name = 'Sélection V1'
WHERE c.trait_id IS NOT NULL
ORDER BY mod.id, c.trait_id, c.display_order
ON CONFLICT DO NOTHING;

INSERT INTO public.program_phenotyping_modules(program_id, module_id, is_active)
SELECT DISTINCT m.program_id, mod.id, TRUE
FROM public.selection_models m
JOIN public.programs p ON p.id = m.program_id
JOIN public.phenotyping_modules mod ON mod.organization_id = p.organization_id AND mod.name = 'Sélection V1'
WHERE m.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Historical raw scores become typed observations of the mapped traits.
INSERT INTO public.phenotype_trait_values(phenotype_evaluation_id, trait_id, numeric_value, created_at)
SELECT s.phenotype_evaluation_id, c.trait_id, s.raw_score, s.created_at
FROM public.phenotype_scores s JOIN public.selection_criteria c ON c.id = s.criterion_id
WHERE s.deleted_at IS NULL AND c.trait_id IS NOT NULL
ON CONFLICT (phenotype_evaluation_id, trait_id) DO NOTHING;
