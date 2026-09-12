-- Centralized business calculations used by the BreedOps API and UI.

CREATE TABLE selection_decision_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  selection_model_id UUID NOT NULL REFERENCES selection_models(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  minimum_weighted_score NUMERIC NOT NULL,
  minimum_stability_score NUMERIC NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (selection_model_id, decision)
);

CREATE INDEX idx_selection_decision_rules_model_id ON selection_decision_rules(selection_model_id);
CREATE TRIGGER update_selection_decision_rules_updated_at
BEFORE UPDATE ON selection_decision_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE selection_decision_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY selection_decision_rules_read ON selection_decision_rules FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_access_program(program_id)));
CREATE POLICY selection_decision_rules_insert ON selection_decision_rules FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_write_program(program_id)));
CREATE POLICY selection_decision_rules_update ON selection_decision_rules FOR UPDATE
  USING (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_access_program(program_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM selection_models WHERE id = selection_model_id AND can_write_program(program_id)));

CREATE OR REPLACE FUNCTION calculate_cross_yield(target_cross_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN pollinated_units > 0 THEN ROUND(total_seeds::NUMERIC / pollinated_units, 2)
    ELSE NULL
  END
  FROM crosses
  WHERE id = target_cross_id AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION calculate_task_delay_days(target_task_id UUID, reference_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN completed_at IS NOT NULL OR due_date IS NULL OR due_date >= reference_date THEN 0
    ELSE reference_date - due_date
  END
  FROM tasks
  WHERE id = target_task_id AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION refresh_phenotype_evaluation(target_evaluation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  model_maximum NUMERIC;
  total_weighted_score NUMERIC;
  stability_score NUMERIC;
  calculated_decision TEXT;
BEGIN
  SELECT maximum_score INTO model_maximum
  FROM selection_models model
  JOIN phenotype_evaluations evaluation ON evaluation.selection_model_id = model.id
  WHERE evaluation.id = target_evaluation_id;

  SELECT
    COALESCE(SUM(score.raw_score * criterion.coefficient), 0),
    MAX(score.raw_score) FILTER (WHERE criterion.code = 'stability')
  INTO total_weighted_score, stability_score
  FROM phenotype_scores score
  JOIN selection_criteria criterion ON criterion.id = score.criterion_id
  WHERE score.phenotype_evaluation_id = target_evaluation_id
    AND score.deleted_at IS NULL
    AND criterion.deleted_at IS NULL;

  SELECT rule.decision INTO calculated_decision
  FROM selection_decision_rules rule
  JOIN phenotype_evaluations evaluation ON evaluation.selection_model_id = rule.selection_model_id
  WHERE evaluation.id = target_evaluation_id
    AND rule.deleted_at IS NULL
    AND total_weighted_score >= rule.minimum_weighted_score
    AND COALESCE(stability_score, 0) >= rule.minimum_stability_score
  ORDER BY rule.display_order ASC
  LIMIT 1;

  UPDATE phenotype_scores score
  SET weighted_value = score.raw_score * criterion.coefficient
  FROM selection_criteria criterion
  WHERE score.phenotype_evaluation_id = target_evaluation_id
    AND score.criterion_id = criterion.id
    AND score.deleted_at IS NULL;

  UPDATE phenotype_evaluations
  SET
    weighted_score = total_weighted_score,
    normalized_score = CASE
      WHEN model_maximum > 0 THEN ROUND((total_weighted_score / model_maximum) * 100, 2)
      ELSE NULL
    END,
    automatic_decision = COALESCE(calculated_decision, 'eliminate')
  WHERE id = target_evaluation_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_phenotype_evaluation_after_score_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM refresh_phenotype_evaluation(COALESCE(NEW.phenotype_evaluation_id, OLD.phenotype_evaluation_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER refresh_phenotype_evaluation_on_score_change
AFTER INSERT OR DELETE OR UPDATE OF raw_score, criterion_id, deleted_at ON phenotype_scores
FOR EACH ROW EXECUTE FUNCTION refresh_phenotype_evaluation_after_score_change();

CREATE OR REPLACE FUNCTION inventory_movement_delta(movement_type TEXT, quantity NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE movement_type
    WHEN 'receipt' THEN quantity
    WHEN 'positive_adjustment' THEN quantity
    WHEN 'return' THEN quantity
    WHEN 'consumption' THEN -quantity
    WHEN 'negative_adjustment' THEN -quantity
    WHEN 'destruction' THEN -quantity
    WHEN 'transfer' THEN -quantity
    ELSE NULL
  END;
$$;

ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_type_check
  CHECK (movement_type IN ('receipt', 'consumption', 'positive_adjustment', 'negative_adjustment', 'transfer', 'destruction', 'return'));
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_quantity_positive_check
  CHECK (quantity > 0);

CREATE OR REPLACE FUNCTION refresh_inventory_lot_quantity(target_inventory_lot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE inventory_lots lot
  SET current_quantity = lot.initial_quantity + COALESCE((
    SELECT SUM(inventory_movement_delta(movement_type, quantity))
    FROM inventory_movements movement
    WHERE movement.inventory_lot_id = target_inventory_lot_id
      AND movement.deleted_at IS NULL
  ), 0)
  WHERE lot.id = target_inventory_lot_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_inventory_lot_after_movement_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM refresh_inventory_lot_quantity(COALESCE(NEW.inventory_lot_id, OLD.inventory_lot_id));
  IF TG_OP = 'UPDATE' AND NEW.inventory_lot_id <> OLD.inventory_lot_id THEN
    PERFORM refresh_inventory_lot_quantity(OLD.inventory_lot_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER refresh_inventory_lot_on_movement_change
AFTER INSERT OR UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION refresh_inventory_lot_after_movement_change();

CREATE OR REPLACE VIEW inventory_lot_status WITH (security_invoker = true) AS
SELECT
  lot.id AS inventory_lot_id,
  item.organization_id,
  lot.current_quantity,
  item.minimum_stock,
  CASE
    WHEN lot.expiration_date IS NULL THEN NULL
    ELSE lot.expiration_date - CURRENT_DATE
  END AS days_before_expiration,
  CASE
    WHEN lot.expiration_date < CURRENT_DATE THEN 'expired'
    WHEN lot.expiration_date <= CURRENT_DATE + 30 THEN 'urgent'
    WHEN lot.expiration_date <= CURRENT_DATE + 90 THEN 'plan'
    WHEN lot.current_quantity <= item.minimum_stock THEN 'order'
    ELSE NULL
  END AS alert_level
FROM inventory_lots lot
JOIN inventory_items item ON item.id = lot.inventory_item_id
WHERE lot.deleted_at IS NULL AND item.deleted_at IS NULL;
