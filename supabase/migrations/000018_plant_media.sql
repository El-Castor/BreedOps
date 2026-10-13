-- Plant Media: private image storage for breeding records.
-- Images live in the private "breedops-media" Storage bucket (declared in
-- supabase/config.toml so it is created automatically by `supabase start`/
-- `db reset`, never by hand in Studio). This table only ever holds
-- metadata and a storage path; it never holds a public or signed URL.
--
-- Targets: exactly one of parent_line_id / family_id / seed_lot_id /
-- phenotype_evaluation_id per row. Crosses are intentionally out of scope
-- for this MVP. organization_id and program_id are derived from the
-- target by a trigger below -- the application never gets to assert them,
-- so a forged or mistaken client value cannot attach media to another
-- team's record.
CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program_id UUID REFERENCES public.programs(id) ON DELETE CASCADE,

  parent_line_id UUID REFERENCES public.parent_lines(id) ON DELETE CASCADE,
  family_id UUID REFERENCES public.families(id) ON DELETE CASCADE,
  seed_lot_id UUID REFERENCES public.seed_lots(id) ON DELETE CASCADE,
  phenotype_evaluation_id UUID REFERENCES public.phenotype_evaluations(id) ON DELETE CASCADE,

  storage_bucket TEXT NOT NULL DEFAULT 'breedops-media',
  storage_path TEXT NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 1 AND 500),

  original_filename TEXT NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),

  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 500),
  media_kind TEXT CHECK (media_kind IS NULL OR media_kind IN (
    'plant', 'organ', 'symptom', 'seed', 'harvest', 'other')),
  captured_at DATE,

  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  archived_at TIMESTAMP,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT media_assets_one_target CHECK (
    num_nonnulls(parent_line_id, family_id, seed_lot_id, phenotype_evaluation_id) = 1)
);
COMMENT ON TABLE public.media_assets IS
  'Plant Media metadata. storage_path points into the private breedops-media bucket; no public or signed URL is ever persisted here.';
COMMENT ON COLUMN public.media_assets.organization_id IS
  'Derived from the target entity by validate_media_asset_target(), not trusted from the client.';

CREATE INDEX media_assets_organization_idx ON public.media_assets(organization_id);
CREATE INDEX media_assets_parent_line_idx ON public.media_assets(parent_line_id) WHERE parent_line_id IS NOT NULL;
CREATE INDEX media_assets_family_idx ON public.media_assets(family_id) WHERE family_id IS NOT NULL;
CREATE INDEX media_assets_seed_lot_idx ON public.media_assets(seed_lot_id) WHERE seed_lot_id IS NOT NULL;
CREATE INDEX media_assets_phenotype_evaluation_idx ON public.media_assets(phenotype_evaluation_id) WHERE phenotype_evaluation_id IS NOT NULL;

-- Exactly one active primary image per target (archived images never count).
CREATE UNIQUE INDEX media_assets_primary_per_parent_line ON public.media_assets(parent_line_id)
  WHERE is_primary AND archived_at IS NULL;
CREATE UNIQUE INDEX media_assets_primary_per_family ON public.media_assets(family_id)
  WHERE is_primary AND archived_at IS NULL;
CREATE UNIQUE INDEX media_assets_primary_per_seed_lot ON public.media_assets(seed_lot_id)
  WHERE is_primary AND archived_at IS NULL;
CREATE UNIQUE INDEX media_assets_primary_per_evaluation ON public.media_assets(phenotype_evaluation_id)
  WHERE is_primary AND archived_at IS NULL;

CREATE TRIGGER update_media_assets_updated_at BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- An archived image is never the primary one: it would otherwise
-- silently become "primary" again on restore with no explicit choice.
CREATE FUNCTION public.clear_media_primary_on_archive()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    NEW.is_primary := FALSE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_assets_clear_primary_on_archive BEFORE INSERT OR UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.clear_media_primary_on_archive();

-- Derive organization_id/program_id from the target entity (SECURITY DEFINER
-- so it can read the target regardless of the caller's own RLS visibility of
-- that row's join path) and reject a target that cannot be resolved. This is
-- the actual security boundary: whatever organization_id/program_id the
-- client sent is discarded and replaced with the target's real ownership
-- before the row is ever checked against RLS or persisted.
CREATE FUNCTION public.validate_media_asset_target()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_org UUID;
  target_program UUID;
BEGIN
  IF NEW.parent_line_id IS NOT NULL THEN
    SELECT p.organization_id, p.id INTO target_org, target_program
      FROM parent_lines pl JOIN programs p ON p.id = pl.program_id
      WHERE pl.id = NEW.parent_line_id;
  ELSIF NEW.family_id IS NOT NULL THEN
    SELECT p.organization_id, p.id INTO target_org, target_program
      FROM families f JOIN programs p ON p.id = f.program_id
      WHERE f.id = NEW.family_id;
  ELSIF NEW.seed_lot_id IS NOT NULL THEN
    SELECT p.organization_id, p.id INTO target_org, target_program
      FROM seed_lots sl JOIN programs p ON p.id = sl.program_id
      WHERE sl.id = NEW.seed_lot_id;
  ELSIF NEW.phenotype_evaluation_id IS NOT NULL THEN
    SELECT p.organization_id, p.id INTO target_org, target_program
      FROM phenotype_evaluations pe
      JOIN phenotypes ph ON ph.id = pe.phenotype_id
      JOIN programs p ON p.id = ph.program_id
      WHERE pe.id = NEW.phenotype_evaluation_id;
  END IF;
  IF target_org IS NULL THEN
    RAISE EXCEPTION 'Media target could not be resolved' USING ERRCODE = '23514';
  END IF;
  NEW.organization_id := target_org;
  NEW.program_id := target_program;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_media_asset_target() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_media_asset_target_trigger BEFORE INSERT ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.validate_media_asset_target();

-- The target and storage identity of a media row are immutable after
-- creation; only presentation metadata, primary status and archive state
-- may change. This keeps the UPDATE RLS policy simple while still blocking
-- any attempt to re-point a row at a different entity or team.
CREATE FUNCTION public.guard_media_asset_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.program_id IS DISTINCT FROM OLD.program_id
    OR NEW.parent_line_id IS DISTINCT FROM OLD.parent_line_id
    OR NEW.family_id IS DISTINCT FROM OLD.family_id
    OR NEW.seed_lot_id IS DISTINCT FROM OLD.seed_lot_id
    OR NEW.phenotype_evaluation_id IS DISTINCT FROM OLD.phenotype_evaluation_id
    OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Media identity and target are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_media_asset_identity_trigger BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_asset_identity();

-- Atomically make one media row the sole active primary for its target.
-- SECURITY INVOKER: both UPDATEs run under the caller's own RLS, so this
-- grants no privilege the caller did not already have.
CREATE FUNCTION public.set_media_primary(target_media_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM media_assets WHERE id = target_media_id AND archived_at IS NULL;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'Media not found or archived' USING ERRCODE = '23514';
  END IF;
  UPDATE media_assets SET is_primary = FALSE
    WHERE is_primary AND archived_at IS NULL AND id <> target_media_id
      AND parent_line_id IS NOT DISTINCT FROM rec.parent_line_id
      AND family_id IS NOT DISTINCT FROM rec.family_id
      AND seed_lot_id IS NOT DISTINCT FROM rec.seed_lot_id
      AND phenotype_evaluation_id IS NOT DISTINCT FROM rec.phenotype_evaluation_id;
  UPDATE media_assets SET is_primary = TRUE WHERE id = target_media_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_media_primary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_media_primary(UUID) TO authenticated;

-- ───────────────────────── Private Storage bucket ─────────────────────────
-- Created here (not by hand in Studio) so it exists identically on every
-- environment that applies this migration, local or hosted. The same
-- bucket is also declared in supabase/config.toml for CLI tooling that
-- reads it declaratively; this INSERT is the part that is actually
-- reproducible via the standard migration workflow.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'breedops-media', 'breedops-media', FALSE, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────── RLS ─────────────────────────
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_assets_read ON public.media_assets FOR SELECT
  USING (can_access_team(organization_id));
CREATE POLICY media_assets_insert ON public.media_assets FOR INSERT
  WITH CHECK (can_write_team(organization_id));
CREATE POLICY media_assets_update ON public.media_assets FOR UPDATE
  USING (can_access_team(organization_id)) WITH CHECK (can_write_team(organization_id));
-- No DELETE policy: media is archived (archived_at), never hard-deleted,
-- matching every other breeding lifecycle table in this schema.
