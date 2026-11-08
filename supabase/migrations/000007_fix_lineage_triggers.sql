-- PostgreSQL resolves fields on a generic trigger record while planning each
-- expression. Separate functions avoid referencing fields absent from a table.
DROP TRIGGER validate_cross_lineage ON public.crosses;
DROP TRIGGER validate_family_lineage ON public.families;
DROP TRIGGER validate_seed_lot_lineage ON public.seed_lots;
DROP FUNCTION public.validate_breeding_lineage();

CREATE FUNCTION public.validate_cross_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM parent_lines female, parent_lines male
    WHERE female.id = NEW.female_parent_id AND male.id = NEW.male_parent_id
      AND female.program_id = NEW.program_id AND male.program_id = NEW.program_id
      AND female.deleted_at IS NULL AND male.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Cross parents must be active lines in the same program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_family_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crosses WHERE id = NEW.cross_id AND program_id = NEW.program_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'Family cross must belong to the same program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_seed_lot_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.cross_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crosses WHERE id = NEW.cross_id AND program_id = NEW.program_id AND deleted_at IS NULL)) OR
     (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM families WHERE id = NEW.family_id AND program_id = NEW.program_id AND deleted_at IS NULL)) OR
     (NEW.family_id IS NOT NULL AND NEW.cross_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM families WHERE id = NEW.family_id AND cross_id = NEW.cross_id))
  THEN RAISE EXCEPTION 'Seed lot lineage must belong to the same program' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_cross_lineage BEFORE INSERT OR UPDATE OF program_id, female_parent_id, male_parent_id ON public.crosses
FOR EACH ROW EXECUTE FUNCTION public.validate_cross_lineage();
CREATE TRIGGER validate_family_lineage BEFORE INSERT OR UPDATE OF program_id, cross_id ON public.families
FOR EACH ROW EXECUTE FUNCTION public.validate_family_lineage();
CREATE TRIGGER validate_seed_lot_lineage BEFORE INSERT OR UPDATE OF program_id, cross_id, family_id ON public.seed_lots
FOR EACH ROW EXECUTE FUNCTION public.validate_seed_lot_lineage();

REVOKE EXECUTE ON FUNCTION public.validate_cross_lineage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_family_lineage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_seed_lot_lineage() FROM PUBLIC, anon, authenticated;
