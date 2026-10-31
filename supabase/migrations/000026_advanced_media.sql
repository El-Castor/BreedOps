-- V2-03: advanced scientific photographs — structured acquisition metadata
-- and non-destructive annotations on top of the existing Plant Media
-- system (migration 000018, left untouched). Additive only.
--
-- Design decisions (see agend.md for the full audit this follows):
--  * captured_at (DATE, existing) keeps its historical meaning unchanged.
--    captured_at_time (TIME, new) is an optional companion: when present,
--    it refines captured_at into an exact timestamp. A CHECK forbids a
--    time without a date, since a bare time of day is not meaningful on
--    its own. This is a strictly additive, backward-compatible field, not
--    a reinterpretation of historical rows.
--  * Capture precision is never a stored enum — it is fully derived from
--    which of (captured_at, captured_at_time) are present:
--      captured_at IS NULL                        -> unknown
--      captured_at IS NOT NULL, time IS NULL       -> date only
--      both present                                -> date + time (exact)
--    Temporal ordering rule (documented once, implemented once, in
--    src/lib/media/temporal.ts): precise timestamp, else capture date
--    (midnight), else created_at (upload time) as a last-resort fallback
--    for undated images, which the UI always labels explicitly as
--    "Date inconnue" rather than passing off an upload time as a capture
--    time.
--  * developmental_stage is a bounded free label, not an enum: BreedOps
--    programs span different species (parent_lines/families/seed_lots
--    carry a free-text "species" already), so a single universal growth
--    ontology (BBCH, Zadoks, ...) would be actively wrong for most of
--    them. A short free label ("D0", "flowering", "callus induction", ...)
--    is accurate; a hard-coded universal enum would not be.
--  * viewpoint and imaging_modality ARE controlled vocabularies: unlike
--    developmental stage, a small fixed set of camera viewpoints/imaging
--    modalities is genuinely meaningful across every current BreedOps
--    context, so a CHECK enum is safe here without inventing anything
--    contradicted by real usage.
--  * operator_id (acquired by) is intentionally separate from created_by
--    (uploaded by, existing column, migration 000018): the person who
--    physically took the photo in the field is often not the person later
--    uploading it from a desktop. Nullable, ON DELETE SET NULL (same
--    action as created_by - a deactivated/deleted profile must never
--    destroy the media record), and validated same-organization by
--    extending validate_media_asset_target() below (never trusted from
--    the client, never allowed to reference another team's profile).
--  * scale_value/scale_unit/scale_note give an optional PHYSICAL
--    calibration reference distinct from the existing pixel width/height
--    columns (migration 000018) - no automated measurement is performed
--    from either. scale_unit is required whenever scale_value is set (a
--    bare number with no unit is meaningless); no value is invented when
--    no calibration exists.
--  * EXIF_STATUS=DEFERRED: no EXIF-reading dependency is introduced this
--    milestone. All acquisition metadata is entered manually through the
--    upload/edit forms, which is fully implemented below; nothing here
--    depends on embedded file metadata that was never trustworthy as
--    authoritative scientific data anyway.
--  * EXPERIMENTAL_CONTEXT=DEFERRED: program_id is already derived from
--    the target entity by the existing trigger. No demonstrated workflow
--    in this milestone requires a further link to a specific task/cycle
--    beyond the target entity itself; the new free-text scientific_note
--    field covers ad hoc context without inventing a relation nothing
--    currently exercises. Documented here rather than guessed at.

ALTER TABLE public.media_assets
  ADD COLUMN captured_at_time TIME,
  ADD COLUMN developmental_stage TEXT
    CHECK (developmental_stage IS NULL OR char_length(developmental_stage) BETWEEN 1 AND 60),
  ADD COLUMN viewpoint TEXT
    CHECK (viewpoint IS NULL OR viewpoint IN ('top','side','front','back','macro','microscope','other')),
  ADD COLUMN imaging_modality TEXT
    CHECK (imaging_modality IS NULL OR imaging_modality IN ('visible','fluorescence','microscopy','scanner','other')),
  ADD COLUMN operator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN scale_value NUMERIC CHECK (scale_value IS NULL OR scale_value > 0),
  ADD COLUMN scale_unit TEXT CHECK (scale_unit IS NULL OR scale_unit IN ('mm','cm','m','px')),
  ADD COLUMN scale_note TEXT CHECK (scale_note IS NULL OR char_length(scale_note) <= 255),
  ADD COLUMN scientific_note TEXT CHECK (scientific_note IS NULL OR char_length(scientific_note) <= 2000),
  ADD CONSTRAINT media_assets_captured_time_requires_date
    CHECK (captured_at_time IS NULL OR captured_at IS NOT NULL),
  ADD CONSTRAINT media_assets_scale_unit_required
    CHECK (scale_value IS NULL OR scale_unit IS NOT NULL);

COMMENT ON COLUMN public.media_assets.captured_at_time IS
  'Optional companion to captured_at (DATE, migration 000018). NULL means the date (if any) is known but not the time of day. Never set without captured_at.';
COMMENT ON COLUMN public.media_assets.operator_id IS
  'Who physically acquired the image ("image acquired by"), distinct from created_by ("uploaded by"). Validated same-organization by validate_media_asset_target(), never trusted from the client.';
COMMENT ON COLUMN public.media_assets.scale_value IS
  'Optional physical calibration reference (e.g. a ruler in frame), never an automated measurement. Distinct from the existing pixel width/height columns.';

-- Shared by both the INSERT path (validate_media_asset_target, below) and
-- the UPDATE path (validate_media_operator_update, further below): raises
-- unless operator_id is NULL or belongs to the given organization. Kept as
-- its own SECURITY DEFINER function so the same organization boundary is
-- enforced identically on insert and on update, rather than duplicated
-- inline and risking the two copies drifting apart.
CREATE FUNCTION public.assert_operator_same_organization(p_operator_id UUID, p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operator_org UUID;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN;
  END IF;
  SELECT organization_id INTO operator_org FROM profiles WHERE id = p_operator_id;
  IF operator_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'operator_id must belong to the same organization as the media target' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_operator_same_organization(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Re-derive organization_id/program_id exactly as migration 000018 did,
-- plus validate the new operator_id: if set, it must belong to the same
-- organization the media row is being attached to. Re-created in full
-- (CREATE OR REPLACE) rather than only diffed, since PL/pgSQL has no
-- partial-function syntax; the original body is unchanged below except
-- for the added operator check.
CREATE OR REPLACE FUNCTION public.validate_media_asset_target()
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

  PERFORM public.assert_operator_same_organization(NEW.operator_id, target_org);

  RETURN NEW;
END;
$$;

-- guard_media_asset_identity (000018) is intentionally left untouched: all
-- new columns above are presentation/scientific metadata, exactly like
-- the existing caption/media_kind/captured_at, and must stay editable —
-- none of them belong in that immutability guard.
--
-- But validate_media_asset_target_trigger (000018) only fires BEFORE
-- INSERT, and updateMediaMetadata() allows operator_id to be changed after
-- creation — so without a dedicated UPDATE-time check, re-pointing an
-- existing media row's operator_id at a profile in a different
-- organization would pass straight through to RLS/storage with no
-- validation at all (the INSERT-only trigger never runs again). This is a
-- genuine database-level integrity gap, not merely a UI concern: it must
-- be rejected inside Postgres regardless of what the UI happens to allow.
-- A dedicated column-scoped trigger (rather than widening the existing
-- 000018 BEFORE INSERT trigger, which belongs to an already-merged,
-- immutable migration) is the simplest, safest fix — it only ever runs
-- when operator_id is part of the UPDATE's target list, reuses the exact
-- same organization check as the INSERT path via
-- assert_operator_same_organization() above, and trusts NEW.organization_id
-- directly: that column is itself guarded immutable on UPDATE by
-- guard_media_asset_identity_trigger (000018), so it always still reflects
-- the row's real, already-validated target organization at this point.
CREATE FUNCTION public.validate_media_operator_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_operator_same_organization(NEW.operator_id, NEW.organization_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_media_operator_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_media_operator_update_trigger BEFORE UPDATE OF operator_id ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.validate_media_operator_update();

-- ───────────────────────── media_annotations ─────────────────────────
-- Non-destructive scientific annotations over an image: the source
-- object in Storage is never touched. Coordinates are normalized to the
-- original image (0..1 on each axis), not screen pixels, so they stay
-- correct at any display size. Ownership is never stored redundantly here
-- (no organization_id column): every RLS policy derives it by joining
-- back to media_assets, which is the single source of truth for who may
-- see or touch a given image's annotations.
CREATE TABLE public.media_annotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('point','rectangle','text')),

  x NUMERIC NOT NULL CHECK (x >= 0 AND x <= 1),
  y NUMERIC NOT NULL CHECK (y >= 0 AND y <= 1),
  width NUMERIC CHECK (width IS NULL OR (width >= 0 AND width <= 1)),
  height NUMERIC CHECK (height IS NULL OR (height >= 0 AND height <= 1)),

  label TEXT CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 300),

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  archived_at TIMESTAMP,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Point and text annotations are a single location (no extent).
  -- Rectangles require an extent that stays inside the unit image: a
  -- rectangle is never allowed to claim it extends outside the image it
  -- annotates.
  CONSTRAINT media_annotations_shape_valid CHECK (
    (annotation_type IN ('point','text') AND width IS NULL AND height IS NULL)
    OR (annotation_type = 'rectangle' AND width IS NOT NULL AND height IS NOT NULL
        AND x + width <= 1 AND y + height <= 1)
  ),
  -- A text annotation with no text would be meaningless; point/rectangle
  -- labels stay optional (a plain marked point/zone is still useful on
  -- its own).
  CONSTRAINT media_annotations_text_requires_label CHECK (
    annotation_type <> 'text' OR label IS NOT NULL
  )
);
COMMENT ON TABLE public.media_annotations IS
  'Non-destructive overlay annotations on a media_assets image. Coordinates are normalized (0..1) to the original image, never screen pixels. The source image object in Storage is never modified.';
COMMENT ON COLUMN public.media_annotations.x IS
  'Normalized X (0=left edge, 1=right edge) of the original image. For a rectangle, the top-left corner.';
COMMENT ON COLUMN public.media_annotations.y IS
  'Normalized Y (0=top edge, 1=bottom edge) of the original image. For a rectangle, the top-left corner.';

CREATE INDEX media_annotations_media_asset_idx ON public.media_annotations(media_asset_id);

CREATE TRIGGER update_media_annotations_updated_at BEFORE UPDATE ON public.media_annotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- An archived annotation is logically "removed" from the active overlay
-- but never deleted, matching every other lifecycle table in this
-- schema (media_assets itself included).
ALTER TABLE public.media_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_annotations_read ON public.media_annotations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_assets ma
    WHERE ma.id = media_annotations.media_asset_id
      AND can_access_team(ma.organization_id)
  ));

-- New annotations may not normally be created on already-archived media
-- (the same "archived = no new content" rule already applied to new
-- uploads on an archived target entity) - existing annotations on media
-- that is archived afterwards remain fully readable above, just no
-- longer writable below.
CREATE POLICY media_annotations_insert ON public.media_annotations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM media_assets ma
    WHERE ma.id = media_annotations.media_asset_id
      AND can_write_team(ma.organization_id)
      AND ma.archived_at IS NULL
  ));

CREATE POLICY media_annotations_update ON public.media_annotations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM media_assets ma
    WHERE ma.id = media_annotations.media_asset_id
      AND can_write_team(ma.organization_id)
      AND ma.archived_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM media_assets ma
    WHERE ma.id = media_annotations.media_asset_id
      AND can_write_team(ma.organization_id)
      AND ma.archived_at IS NULL
  ));
-- No DELETE policy: annotations are archived, never hard-deleted.

-- The annotation's own target/media identity must stay immutable after
-- creation, mirroring guard_media_asset_identity on media_assets itself -
-- only label, coordinates and archive state may change.
CREATE FUNCTION public.guard_media_annotation_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.media_asset_id IS DISTINCT FROM OLD.media_asset_id
    OR NEW.annotation_type IS DISTINCT FROM OLD.annotation_type
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Annotation identity and target are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_media_annotation_identity_trigger BEFORE UPDATE ON public.media_annotations
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_annotation_identity();

REVOKE ALL ON public.media_annotations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.media_annotations TO authenticated;
