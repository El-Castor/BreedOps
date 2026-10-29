-- Business completion milestone: four independent, additive gaps closed.
-- Does not touch migrations 000001-000021. Nothing here resets or drops
-- existing data; every ALTER is additive or a constrained backfill of the
-- single pre-existing seed_lots.status default value.

-- ═══════════════════════ A. Seed lot operational lifecycle ═══════════════════════
-- seed_lots.status has existed since 000001 but was always 'active' and never
-- read, written, or constrained anywhere in the application: a vestigial
-- column borrowed from the generic breeding-entity status label shared by
-- parent_lines/crosses/families, which does not fit a seed lot's real
-- operational concerns. genetic_purity_status (verified/pending/failed/
-- unknown) already covers genetic purity; archival already has deleted_at.
-- What's actually missing is an operational hold/exhaustion state, backed by
-- a real transition rule instead of free text.
--
-- Three states, chosen because they are the only ones the existing model can
-- support without fabricating data the application doesn't have: seed lots
-- carry no sowing/distribution ledger (unlike inventory_lots, which has
-- inventory_movements), so "low" cannot be computed and is deliberately not
-- added. "archived" is deliberately not a status value: deleted_at remains
-- the sole archival mechanism, per the existing convention for every
-- breeding entity.
--   available   - usable (default; replaces the old 'active')
--   quarantined - an operational hold pending verification before use,
--                 independent of genetic_purity_status (e.g. a suspected
--                 contamination report, pending relabelling)
--   depleted    - manually recorded as exhausted; terminal (no real-world
--                 way to "undeplete" a lot with no seeds left)
UPDATE public.seed_lots SET status = 'available' WHERE status IS DISTINCT FROM 'available';
ALTER TABLE public.seed_lots ALTER COLUMN status SET DEFAULT 'available';
ALTER TABLE public.seed_lots
  ADD CONSTRAINT seed_lots_status_check
  CHECK (status IN ('available', 'quarantined', 'depleted'));
COMMENT ON COLUMN public.seed_lots.status IS
  'Operational lifecycle (available/quarantined/depleted), independent of genetic_purity_status and of archival (deleted_at). Transitions are enforced by validate_seed_lot_status_transition().';

CREATE FUNCTION public.validate_seed_lot_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'depleted' THEN
    RAISE EXCEPTION 'A depleted seed lot cannot change status' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.status = 'available' AND NEW.status IN ('quarantined', 'depleted'))
    OR (OLD.status = 'quarantined' AND NEW.status IN ('available', 'depleted'))
  ) THEN
    RAISE EXCEPTION 'Invalid seed lot status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_seed_lot_status_transition() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validate_seed_lot_status_transition
  BEFORE UPDATE OF status ON public.seed_lots
  FOR EACH ROW EXECUTE FUNCTION public.validate_seed_lot_status_transition();

-- An operational status change is the one genuinely new sensitive mutation
-- this milestone introduces for seed lots, so it gets a real audit event
-- (reusing the existing audit_logs architecture from migration 000012/000021
-- rather than a parallel one) instead of a bare client-side UPDATE. The
-- mutation and its audit record share this function's implicit transaction,
-- so they are atomic the same way migration 000021 made import atomic with
-- its audit event. This does not retroactively add history to every
-- existing breeding mutation (documented as a conscious post-V1 boundary in
-- agend.md) — only to this new one.
CREATE FUNCTION public.update_seed_lot_status(target_lot_id UUID, new_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program_id UUID;
  v_organization_id UUID;
  v_old_status TEXT;
BEGIN
  SELECT sl.program_id, sl.status INTO v_program_id, v_old_status
  FROM seed_lots sl WHERE sl.id = target_lot_id;
  IF v_program_id IS NULL OR NOT can_write_program(v_program_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF new_status NOT IN ('available', 'quarantined', 'depleted') THEN
    RAISE EXCEPTION 'Unsupported status' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_organization_id FROM programs WHERE id = v_program_id;

  UPDATE seed_lots SET status = new_status WHERE id = target_lot_id;

  IF v_old_status IS DISTINCT FROM new_status THEN
    INSERT INTO audit_logs(
      organization_id, program_id, user_id, entity_type, entity_id, action, old_values, new_values)
    VALUES (
      v_organization_id, v_program_id, auth.uid(), 'seed_lots', target_lot_id, 'modification',
      jsonb_build_object('status', v_old_status), jsonb_build_object('status', new_status));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_seed_lot_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_seed_lot_status(UUID, TEXT) TO authenticated;

-- ═══════════════════════ B. Eliminatory criteria ═══════════════════════
-- selection_criteria.is_eliminatory / eliminatory_threshold have existed
-- since 000001 but refresh_phenotype_evaluation() never read them: a
-- criterion could be flagged eliminatory in the UI's configuration screen
-- and have zero effect on the automatic decision. This closes that gap
-- without touching the existing weighted/normalized score calculation.
--
-- Semantics (documented once, enforced consistently): eliminatory_threshold
-- is a MINIMUM acceptable raw_score, matching every other "minimum_*"
-- column already in this schema (minimum_weighted_score,
-- minimum_stability_score, minimum_value). raw_score < eliminatory_threshold
-- on any active, non-deleted eliminatory criterion forces automatic_decision
-- to 'eliminate', overriding whatever selection_decision_rules would
-- otherwise have matched from the weighted score alone. A criterion with
-- is_eliminatory but no eliminatory_threshold configured never eliminates
-- (no gate defined, not an error). A missing score for an active eliminatory
-- criterion is treated as a failure: fail-safe, so an incomplete evaluation
-- can never be promoted to a non-eliminate decision on a gated trait.
ALTER TABLE public.phenotype_evaluations
  ADD COLUMN IF NOT EXISTS is_eliminated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS elimination_reasons TEXT[];
COMMENT ON COLUMN public.phenotype_evaluations.is_eliminated IS
  'Set by refresh_phenotype_evaluation() when an active is_eliminatory criterion fails its eliminatory_threshold (or has no score), independent of the weighted/normalized score. automatic_decision is forced to eliminate whenever this is true.';
COMMENT ON COLUMN public.phenotype_evaluations.elimination_reasons IS
  'One human-readable string per failing eliminatory criterion (name, observed value, threshold); NULL when is_eliminated is false.';

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
  eliminated BOOLEAN := FALSE;
  reasons TEXT[] := ARRAY[]::TEXT[];
  gate RECORD;
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

  FOR gate IN
    SELECT c.id, c.name, c.eliminatory_threshold,
      (SELECT s.raw_score FROM phenotype_scores s
       WHERE s.phenotype_evaluation_id = target_evaluation_id
         AND s.criterion_id = c.id AND s.deleted_at IS NULL) AS raw_score
    FROM selection_criteria c
    JOIN phenotype_evaluations evaluation ON evaluation.selection_model_id = c.selection_model_id
    WHERE evaluation.id = target_evaluation_id
      AND c.deleted_at IS NULL
      AND c.is_eliminatory
      AND c.eliminatory_threshold IS NOT NULL
  LOOP
    IF gate.raw_score IS NULL THEN
      eliminated := TRUE;
      reasons := reasons || (gate.name || ' : note manquante (seuil éliminatoire ' || gate.eliminatory_threshold::TEXT || ')');
    ELSIF gate.raw_score < gate.eliminatory_threshold THEN
      eliminated := TRUE;
      reasons := reasons || (gate.name || ' : ' || gate.raw_score::TEXT || ' < seuil éliminatoire ' || gate.eliminatory_threshold::TEXT);
    END IF;
  END LOOP;

  IF eliminated THEN
    calculated_decision := 'eliminate';
  ELSE
    SELECT rule.decision INTO calculated_decision
    FROM selection_decision_rules rule
    JOIN phenotype_evaluations evaluation ON evaluation.selection_model_id = rule.selection_model_id
    WHERE evaluation.id = target_evaluation_id
      AND rule.deleted_at IS NULL
      AND total_weighted_score >= rule.minimum_weighted_score
      AND COALESCE(stability_score, 0) >= rule.minimum_stability_score
    ORDER BY rule.display_order ASC
    LIMIT 1;
  END IF;

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
    automatic_decision = COALESCE(calculated_decision, 'eliminate'),
    is_eliminated = eliminated,
    elimination_reasons = CASE WHEN eliminated THEN reasons ELSE NULL END
  WHERE id = target_evaluation_id;
END;
$$;

-- ═══════════════════════ C. Equipment register ═══════════════════════
-- Absent from every migration and from PROMPT.md's own minimal data model
-- for Module 4 (only inventory_items/inventory_lots/inventory_movements are
-- specified there) even though the roadmap checkbox names it. A laboratory
-- operational register, not a reagent lot: no quantity, no expiration, no
-- movement ledger - kept as its own table rather than forced into
-- inventory_lots semantics, organization-scoped like inventory_items.
CREATE TABLE public.equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 80),
  manufacturer TEXT CHECK (manufacturer IS NULL OR char_length(manufacturer) <= 160),
  model TEXT CHECK (model IS NULL OR char_length(model) <= 160),
  serial_number TEXT CHECK (serial_number IS NULL OR char_length(serial_number) <= 160),
  location TEXT CHECK (location IS NULL OR char_length(location) <= 160),
  operational_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (operational_status IN ('operational', 'maintenance', 'out_of_service')),
  commissioned_at DATE,
  next_maintenance_at DATE,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  CONSTRAINT equipment_serial_unique UNIQUE (organization_id, serial_number)
);
CREATE INDEX equipment_organization_idx ON public.equipment(organization_id);
COMMENT ON TABLE public.equipment IS
  'Laboratory equipment operational register, organization-scoped. Conceptually distinct from reagent-lot inventory: no quantity or movement ledger.';

CREATE TRIGGER update_equipment_updated_at BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
-- Matches the current (000014) read convention: archived rows stay
-- readable so an authorized user can inspect and restore them; there is no
-- DELETE policy anywhere in this schema, archival is deleted_at only.
CREATE POLICY equipment_read ON public.equipment FOR SELECT
  USING (can_access_team(organization_id));
CREATE POLICY equipment_insert ON public.equipment FOR INSERT
  WITH CHECK (can_write_team(organization_id));
CREATE POLICY equipment_update ON public.equipment FOR UPDATE
  USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));

-- ═══════════════════════ D. Inventory stock coverage ═══════════════════════
-- PROMPT.md §9: estimated_coverage = current_quantity / average_weekly_consumption.
-- No consumption aggregation existed anywhere before this. Window is a fixed,
-- explicit 90 days (~12.857 weeks): long enough to smooth noisy single
-- movements, short enough to stay "recent" like the existing expiration
-- alert windows (30/90 days). Only movement_type = 'consumption' counts
-- towards the denominator - never receipts, and never the other decreasing
-- types (negative_adjustment, destruction, transfer), which are corrections
-- or departures from the lab rather than real usage. Returns NULL (not 0,
-- not an error) for average_weekly_consumption/estimated_weeks_remaining
-- when there is no consumption history in the window, instead of
-- fabricating a coverage figure from no data; has_sufficient_data makes
-- that state explicit for the UI. Archived (deleted_at) lots are excluded
-- from both stock and consumption. security_invoker, same convention as the
-- existing inventory_lot_status view: RLS on the underlying tables is what
-- actually scopes every caller to their own organization.
CREATE OR REPLACE VIEW public.inventory_item_coverage WITH (security_invoker = true) AS
WITH consumption AS (
  SELECT lot.inventory_item_id, SUM(movement.quantity) AS total_consumption_90d
  FROM inventory_movements movement
  JOIN inventory_lots lot ON lot.id = movement.inventory_lot_id
  WHERE movement.movement_type = 'consumption'
    AND movement.deleted_at IS NULL
    AND lot.deleted_at IS NULL
    AND movement.movement_date >= CURRENT_DATE - 90
  GROUP BY lot.inventory_item_id
),
stock AS (
  SELECT lot.inventory_item_id, SUM(lot.current_quantity) AS current_quantity
  FROM inventory_lots lot
  WHERE lot.deleted_at IS NULL
  GROUP BY lot.inventory_item_id
)
SELECT
  item.id AS inventory_item_id,
  item.organization_id,
  item.name,
  item.default_unit,
  item.minimum_stock,
  COALESCE(stock.current_quantity, 0) AS current_quantity,
  consumption.total_consumption_90d,
  (consumption.total_consumption_90d IS NOT NULL AND consumption.total_consumption_90d > 0) AS has_sufficient_data,
  CASE WHEN consumption.total_consumption_90d > 0
    THEN ROUND(consumption.total_consumption_90d / (90.0 / 7), 4)
    ELSE NULL
  END AS average_weekly_consumption,
  CASE WHEN consumption.total_consumption_90d > 0
    THEN ROUND(COALESCE(stock.current_quantity, 0) / (consumption.total_consumption_90d / (90.0 / 7)), 1)
    ELSE NULL
  END AS estimated_weeks_remaining,
  CASE WHEN consumption.total_consumption_90d > 0
    THEN COALESCE(stock.current_quantity, 0) / (consumption.total_consumption_90d / (90.0 / 7)) < 4
    ELSE FALSE
  END AS low_coverage
FROM inventory_items item
LEFT JOIN stock ON stock.inventory_item_id = item.id
LEFT JOIN consumption ON consumption.inventory_item_id = item.id
WHERE item.deleted_at IS NULL;

COMMENT ON VIEW public.inventory_item_coverage IS
  'Estimated stock coverage per item over a fixed trailing 90-day window, counting only movement_type = consumption. average_weekly_consumption and estimated_weeks_remaining are NULL when has_sufficient_data is false (no consumption recorded in the window), never a fabricated 0 or infinite value. low_coverage flags under 4 weeks remaining when data is sufficient.';
