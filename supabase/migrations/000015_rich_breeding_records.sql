-- Durable provenance for parent lines and set-based access to cross yield.
-- Additive and nullable: retained records stay valid without backfill.

ALTER TABLE public.parent_lines
  ADD COLUMN accession TEXT
    CHECK (accession IS NULL OR char_length(accession) BETWEEN 1 AND 120),
  ADD COLUMN source TEXT
    CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 160);

COMMENT ON COLUMN public.parent_lines.accession IS
  'External accession or genebank identifier; descriptive, never the BreedOps code.';
COMMENT ON COLUMN public.parent_lines.source IS
  'Breeder, institute or supplier the line was obtained from.';
COMMENT ON COLUMN public.parent_lines.origin IS
  'Provenance or pedigree origin described by the breeder.';

-- Yield is a historical fact of the cross: it remains computable after archive.
CREATE OR REPLACE FUNCTION public.calculate_cross_yield(target_cross_id UUID)
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
  WHERE id = target_cross_id;
$$;

-- Invoker rights: RLS on crosses limits results to programs the caller can read.
CREATE FUNCTION public.program_cross_yields(target_program_id UUID)
RETURNS TABLE (cross_id UUID, seed_yield NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT id, public.calculate_cross_yield(id)
  FROM crosses
  WHERE program_id = target_program_id;
$$;

REVOKE ALL ON FUNCTION public.program_cross_yields(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.program_cross_yields(UUID) TO authenticated;
