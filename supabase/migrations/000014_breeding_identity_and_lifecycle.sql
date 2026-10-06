-- Stable, program-scoped business identifiers and reversible breeding lifecycle.

CREATE TABLE public.breeding_code_counters (
  program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('parent', 'cross', 'family', 'seed_lot', 'phenotype')),
  last_value BIGINT NOT NULL CHECK (last_value > 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (program_id, entity_type)
);

ALTER TABLE public.breeding_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.breeding_code_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_breeding_business_code(
  target_program_id UUID,
  target_entity_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  program_prefix TEXT;
  type_prefix TEXT;
  existing_max BIGINT;
  next_value BIGINT;
  candidate TEXT;
  candidate_exists BOOLEAN;
BEGIN
  IF target_entity_type NOT IN ('parent', 'cross', 'family', 'seed_lot', 'phenotype') THEN
    RAISE EXCEPTION 'Unsupported breeding entity type';
  END IF;

  SELECT UPPER(REGEXP_REPLACE(code, '[^A-Za-z0-9]+', '', 'g'))
  INTO program_prefix
  FROM public.programs
  WHERE id = target_program_id AND deleted_at IS NULL;

  IF program_prefix IS NULL OR program_prefix = '' THEN
    RAISE EXCEPTION 'An active program with a usable code is required';
  END IF;

  type_prefix := CASE target_entity_type
    WHEN 'parent' THEN 'P'
    WHEN 'cross' THEN 'X'
    WHEN 'family' THEN 'F'
    WHEN 'seed_lot' THEN 'L'
    WHEN 'phenotype' THEN 'I'
  END;

  -- Serialize generation for one program/entity pair. The counter row then
  -- provides a durable monotonic value without deriving identity from counts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_program_id::TEXT || ':' || target_entity_type, 0)
  );

  EXECUTE CASE target_entity_type
    WHEN 'parent' THEN
      'SELECT COALESCE(MAX((SUBSTRING(parent_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.parent_lines WHERE program_id = $1 AND parent_code ~ $2'
    WHEN 'cross' THEN
      'SELECT COALESCE(MAX((SUBSTRING(cross_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.crosses WHERE program_id = $1 AND cross_code ~ $2'
    WHEN 'family' THEN
      'SELECT COALESCE(MAX((SUBSTRING(family_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.families WHERE program_id = $1 AND family_code ~ $2'
    WHEN 'seed_lot' THEN
      'SELECT COALESCE(MAX((SUBSTRING(seed_lot_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.seed_lots WHERE program_id = $1 AND seed_lot_code ~ $2'
    WHEN 'phenotype' THEN
      'SELECT COALESCE(MAX((SUBSTRING(phenotype_code FROM ''([0-9]+)$''))::BIGINT), 0) FROM public.phenotypes WHERE program_id = $1 AND phenotype_code ~ $2'
  END
  INTO existing_max
  USING target_program_id, '^' || program_prefix || '-' || type_prefix || '-[0-9]+$';

  INSERT INTO public.breeding_code_counters (program_id, entity_type, last_value)
  VALUES (target_program_id, target_entity_type, existing_max + 1)
  ON CONFLICT (program_id, entity_type) DO UPDATE
  SET last_value = GREATEST(
        public.breeding_code_counters.last_value + 1,
        EXCLUDED.last_value
      ),
      updated_at = NOW()
  RETURNING last_value INTO next_value;

  LOOP
    candidate := program_prefix || '-' || type_prefix || '-' || LPAD(next_value::TEXT, 4, '0');

    EXECUTE CASE target_entity_type
      WHEN 'parent' THEN 'SELECT EXISTS (SELECT 1 FROM public.parent_lines WHERE parent_code = $1)'
      WHEN 'cross' THEN 'SELECT EXISTS (SELECT 1 FROM public.crosses WHERE cross_code = $1)'
      WHEN 'family' THEN 'SELECT EXISTS (SELECT 1 FROM public.families WHERE family_code = $1)'
      WHEN 'seed_lot' THEN 'SELECT EXISTS (SELECT 1 FROM public.seed_lots WHERE seed_lot_code = $1)'
      WHEN 'phenotype' THEN 'SELECT EXISTS (SELECT 1 FROM public.phenotypes WHERE phenotype_code = $1)'
    END
    INTO candidate_exists
    USING candidate;

    EXIT WHEN NOT candidate_exists;

    UPDATE public.breeding_code_counters
    SET last_value = last_value + 1, updated_at = NOW()
    WHERE program_id = target_program_id AND entity_type = target_entity_type
    RETURNING last_value INTO next_value;
  END LOOP;

  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.next_breeding_business_code(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Trigger arguments name the code column and entity type. Fields are read
-- through jsonb because a shared PL/pgSQL trigger cannot reference columns that
-- are absent from some of the tables it is attached to.
CREATE OR REPLACE FUNCTION public.assign_breeding_business_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(BTRIM(to_jsonb(NEW) ->> TG_ARGV[0]), '') IS NULL THEN
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        TG_ARGV[0],
        public.next_breeding_business_code(NEW.program_id, TG_ARGV[1])
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_breeding_business_code()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER assign_parent_line_business_code
  BEFORE INSERT ON public.parent_lines
  FOR EACH ROW EXECUTE FUNCTION public.assign_breeding_business_code('parent_code', 'parent');
CREATE TRIGGER assign_cross_business_code
  BEFORE INSERT ON public.crosses
  FOR EACH ROW EXECUTE FUNCTION public.assign_breeding_business_code('cross_code', 'cross');
CREATE TRIGGER assign_family_business_code
  BEFORE INSERT ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.assign_breeding_business_code('family_code', 'family');
CREATE TRIGGER assign_seed_lot_business_code
  BEFORE INSERT ON public.seed_lots
  FOR EACH ROW EXECUTE FUNCTION public.assign_breeding_business_code('seed_lot_code', 'seed_lot');
CREATE TRIGGER assign_phenotype_business_code
  BEFORE INSERT ON public.phenotypes
  FOR EACH ROW EXECUTE FUNCTION public.assign_breeding_business_code('phenotype_code', 'phenotype');

-- Business codes are stable identities: once assigned they cannot be rewritten.
CREATE OR REPLACE FUNCTION public.guard_breeding_business_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) ->> TG_ARGV[0]) IS DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Breeding business codes are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_breeding_business_code()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_parent_line_business_code
  BEFORE UPDATE OF parent_code ON public.parent_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_breeding_business_code('parent_code');
CREATE TRIGGER guard_cross_business_code
  BEFORE UPDATE OF cross_code ON public.crosses
  FOR EACH ROW EXECUTE FUNCTION public.guard_breeding_business_code('cross_code');
CREATE TRIGGER guard_family_business_code
  BEFORE UPDATE OF family_code ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.guard_breeding_business_code('family_code');
CREATE TRIGGER guard_seed_lot_business_code
  BEFORE UPDATE OF seed_lot_code ON public.seed_lots
  FOR EACH ROW EXECUTE FUNCTION public.guard_breeding_business_code('seed_lot_code');
CREATE TRIGGER guard_phenotype_business_code
  BEFORE UPDATE OF phenotype_code ON public.phenotypes
  FOR EACH ROW EXECUTE FUNCTION public.guard_breeding_business_code('phenotype_code');

-- Authorized users must be able to inspect and restore archived records.
-- Write authorization remains identical to active records; no DELETE policy exists.
DROP POLICY parent_lines_read ON public.parent_lines;
CREATE POLICY parent_lines_read ON public.parent_lines FOR SELECT
  USING (can_access_program(program_id));
DROP POLICY crosses_read ON public.crosses;
CREATE POLICY crosses_read ON public.crosses FOR SELECT
  USING (can_access_program(program_id));
DROP POLICY families_read ON public.families;
CREATE POLICY families_read ON public.families FOR SELECT
  USING (can_access_program(program_id));
DROP POLICY seed_lots_read ON public.seed_lots;
CREATE POLICY seed_lots_read ON public.seed_lots FOR SELECT
  USING (can_access_program(program_id));
