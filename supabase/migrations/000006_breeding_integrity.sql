-- V1.2 breeding workflow integrity. Cross-table program consistency cannot be
-- represented by a simple CHECK constraint, so it is validated by triggers.
ALTER TABLE public.programs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.parent_lines ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.crosses ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.crosses ALTER COLUMN female_parent_id SET NOT NULL;
ALTER TABLE public.crosses ALTER COLUMN male_parent_id SET NOT NULL;
ALTER TABLE public.families ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.families ALTER COLUMN cross_id SET NOT NULL;
ALTER TABLE public.seed_lots ALTER COLUMN program_id SET NOT NULL;
ALTER TABLE public.germination_tests ALTER COLUMN seed_lot_id SET NOT NULL;

ALTER TABLE public.parent_lines ADD CONSTRAINT parent_lines_generation_positive CHECK (generation IS NULL OR generation >= 0);
ALTER TABLE public.crosses ADD CONSTRAINT crosses_distinct_parents CHECK (female_parent_id <> male_parent_id);
ALTER TABLE public.crosses ADD CONSTRAINT crosses_counts_valid CHECK (
  (pollinated_units IS NULL OR pollinated_units >= 0) AND
  (established_units IS NULL OR established_units >= 0) AND
  (total_seeds IS NULL OR total_seeds >= 0) AND
  (established_units IS NULL OR pollinated_units IS NULL OR established_units <= pollinated_units)
);
ALTER TABLE public.seed_lots ADD CONSTRAINT seed_lots_quantity_nonnegative CHECK (total_quantity IS NULL OR total_quantity >= 0);
ALTER TABLE public.germination_tests ADD CONSTRAINT germination_test_counts_valid CHECK (
  seeds_tested > 0 AND seeds_germinated >= 0 AND seeds_germinated <= seeds_tested
);
ALTER TABLE public.germination_tests ADD CONSTRAINT germination_test_day_positive CHECK (evaluation_day IS NULL OR evaluation_day >= 0);

CREATE FUNCTION public.validate_breeding_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'crosses' AND NOT EXISTS (
    SELECT 1 FROM parent_lines female, parent_lines male
    WHERE female.id = NEW.female_parent_id AND male.id = NEW.male_parent_id
      AND female.program_id = NEW.program_id AND male.program_id = NEW.program_id
      AND female.deleted_at IS NULL AND male.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Cross parents must be active lines in the same program' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'families' AND NOT EXISTS (
    SELECT 1 FROM crosses WHERE id = NEW.cross_id AND program_id = NEW.program_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Family cross must belong to the same program' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'seed_lots' AND (
    (NEW.cross_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crosses WHERE id = NEW.cross_id AND program_id = NEW.program_id AND deleted_at IS NULL)) OR
    (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM families WHERE id = NEW.family_id AND program_id = NEW.program_id AND deleted_at IS NULL)) OR
    (NEW.family_id IS NOT NULL AND NEW.cross_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM families WHERE id = NEW.family_id AND cross_id = NEW.cross_id))
  ) THEN RAISE EXCEPTION 'Seed lot lineage must belong to the same program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_cross_lineage BEFORE INSERT OR UPDATE OF program_id, female_parent_id, male_parent_id ON public.crosses
FOR EACH ROW EXECUTE FUNCTION public.validate_breeding_lineage();
CREATE TRIGGER validate_family_lineage BEFORE INSERT OR UPDATE OF program_id, cross_id ON public.families
FOR EACH ROW EXECUTE FUNCTION public.validate_breeding_lineage();
CREATE TRIGGER validate_seed_lot_lineage BEFORE INSERT OR UPDATE OF program_id, cross_id, family_id ON public.seed_lots
FOR EACH ROW EXECUTE FUNCTION public.validate_breeding_lineage();

REVOKE EXECUTE ON FUNCTION public.validate_breeding_lineage() FROM PUBLIC, anon, authenticated;
