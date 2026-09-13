ALTER TABLE public.inventory_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.inventory_items ALTER COLUMN default_unit SET NOT NULL;
ALTER TABLE public.inventory_items ALTER COLUMN minimum_stock SET NOT NULL;
ALTER TABLE public.inventory_lots ALTER COLUMN inventory_item_id SET NOT NULL;
ALTER TABLE public.inventory_lots ALTER COLUMN initial_quantity SET NOT NULL;
ALTER TABLE public.inventory_lots ALTER COLUMN current_quantity SET NOT NULL;
ALTER TABLE public.inventory_movements ALTER COLUMN inventory_lot_id SET NOT NULL;
ALTER TABLE public.inventory_movements ALTER COLUMN movement_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.inventory_movements ALTER COLUMN movement_date SET NOT NULL;
ALTER TABLE public.inventory_movements ALTER COLUMN unit SET NOT NULL;
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_minimum_stock_nonnegative CHECK (minimum_stock >= 0);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_quantities_nonnegative CHECK (initial_quantity >= 0 AND current_quantity >= 0);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_dates_valid CHECK (expiration_date IS NULL OR received_at IS NULL OR expiration_date >= received_at);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_batch_unique UNIQUE (inventory_item_id, batch_number);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_adjustment_reason_required CHECK (
  movement_type NOT IN ('positive_adjustment', 'negative_adjustment') OR length(trim(reason)) > 0
);

CREATE FUNCTION public.create_inventory_lot_with_receipt(
  target_item_id uuid,
  target_batch_number text,
  target_received_at date,
  target_expiration_date date,
  target_quantity numeric,
  target_location text,
  target_reason text DEFAULT 'Initial reception'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_lot_id uuid; actor_id uuid; target_unit text;
BEGIN
  SELECT p.id INTO actor_id FROM profiles p
  WHERE p.user_id = auth.uid() AND p.is_active AND p.deleted_at IS NULL;
  SELECT i.default_unit INTO target_unit FROM inventory_items i
  WHERE i.id = target_item_id AND i.deleted_at IS NULL AND can_write_team(i.organization_id);
  IF actor_id IS NULL OR target_unit IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF length(trim(target_batch_number)) < 1 OR target_quantity <= 0 THEN RAISE EXCEPTION 'Invalid lot' USING ERRCODE='22023'; END IF;
  IF target_expiration_date IS NOT NULL AND target_expiration_date < target_received_at THEN RAISE EXCEPTION 'Invalid expiration date' USING ERRCODE='23514'; END IF;
  INSERT INTO inventory_lots(inventory_item_id,batch_number,received_at,expiration_date,initial_quantity,current_quantity,storage_location,status)
  VALUES(target_item_id,trim(target_batch_number),target_received_at,target_expiration_date,0,0,nullif(trim(target_location),''),'active')
  RETURNING id INTO target_lot_id;
  INSERT INTO inventory_movements(inventory_lot_id,movement_type,quantity,unit,movement_date,performed_by,reason)
  VALUES(target_lot_id,'receipt',target_quantity,target_unit,target_received_at,actor_id,nullif(trim(target_reason),''));
  RETURN target_lot_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_inventory_lot_with_receipt(uuid,text,date,date,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_lot_with_receipt(uuid,text,date,date,numeric,text,text) TO authenticated;

CREATE FUNCTION public.record_inventory_movement(
  target_lot_id uuid,
  target_movement_type text,
  target_quantity numeric,
  target_date date,
  target_reason text,
  target_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE movement_id uuid; actor_id uuid; target_unit text; current_stock numeric; delta numeric;
BEGIN
  SELECT p.id INTO actor_id FROM profiles p
  WHERE p.user_id = auth.uid() AND p.is_active AND p.deleted_at IS NULL;
  SELECT i.default_unit, l.current_quantity INTO target_unit, current_stock
  FROM inventory_lots l JOIN inventory_items i ON i.id=l.inventory_item_id
  WHERE l.id=target_lot_id AND l.deleted_at IS NULL AND i.deleted_at IS NULL AND can_write_team(i.organization_id)
  FOR UPDATE OF l;
  delta := inventory_movement_delta(target_movement_type,target_quantity);
  IF actor_id IS NULL OR target_unit IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF target_quantity <= 0 OR delta IS NULL THEN RAISE EXCEPTION 'Invalid movement' USING ERRCODE='22023'; END IF;
  IF target_movement_type IN ('positive_adjustment','negative_adjustment') AND length(trim(target_reason)) < 1
  THEN RAISE EXCEPTION 'Adjustment reason required' USING ERRCODE='23514'; END IF;
  IF current_stock + delta < 0 THEN RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='23514'; END IF;
  INSERT INTO inventory_movements(inventory_lot_id,movement_type,quantity,unit,movement_date,performed_by,reason,notes)
  VALUES(target_lot_id,target_movement_type,target_quantity,target_unit,target_date,actor_id,nullif(trim(target_reason),''),nullif(trim(target_notes),''))
  RETURNING id INTO movement_id;
  RETURN movement_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_inventory_movement(uuid,text,numeric,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(uuid,text,numeric,date,text,text) TO authenticated;

REVOKE INSERT ON public.inventory_movements FROM anon, authenticated;
