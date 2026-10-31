"use server";

import { z } from "zod";
import { requireIdentity } from "../auth";
import { actionError, actionSuccess, type ActionState } from "../action-state";
import { sniffImageMimeType, readImageDimensions } from "./image-signature";
import {
  buildMediaStoragePath,
  createMediaSignedUrl,
  removeMediaObject,
  uploadMediaObject,
} from "./storage";
import {
  acceptedMimeTypes,
  annotationTypes,
  imagingModalities,
  maxMediaBytes,
  mediaKinds,
  scaleUnits,
  viewpoints,
  type MediaAnnotation,
  type MediaAsset,
  type MediaTargetType,
} from "./types";
import { validateAnnotationGeometry } from "./annotation-validation";
import { compareTemporalAscending } from "./temporal";

const targetTypeSchema = z.enum([
  "parent_line",
  "family",
  "seed_lot",
  "phenotype_evaluation",
]);
const id = z.string().uuid();

const targetTable: Record<MediaTargetType, string> = {
  parent_line: "parent_lines",
  family: "families",
  seed_lot: "seed_lots",
  phenotype_evaluation: "phenotype_evaluations",
};
const targetColumn: Record<MediaTargetType, string> = {
  parent_line: "parent_line_id",
  family: "family_id",
  seed_lot: "seed_lot_id",
  phenotype_evaluation: "phenotype_evaluation_id",
};

type Identity = Awaited<ReturnType<typeof requireIdentity>>;

// RLS already scopes this read to the caller's team; a null result means
// "not found or not authorized" and the two are deliberately indistinguishable
// to the caller.
async function resolveTarget(
  client: Identity["client"],
  targetType: MediaTargetType,
  targetId: string,
) {
  const { data } = await client
    .from(targetTable[targetType])
    .select("id,deleted_at")
    .eq("id", targetId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, archived: data.deleted_at != null };
}

const rowSelect =
  "id,original_filename,mime_type,byte_size,width,height,caption,media_kind,captured_at,captured_at_time,developmental_stage,viewpoint,imaging_modality,operator_id,scale_value,scale_unit,scale_note,scientific_note,is_primary,sort_order,created_at,archived_at,phenotype_evaluation_id";

type Row = {
  id: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  media_kind: string | null;
  captured_at: string | null;
  captured_at_time: string | null;
  developmental_stage: string | null;
  viewpoint: string | null;
  imaging_modality: string | null;
  operator_id: string | null;
  scale_value: number | null;
  scale_unit: string | null;
  scale_note: string | null;
  scientific_note: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  archived_at: string | null;
  phenotype_evaluation_id: string | null;
};

function toAsset(
  row: Row,
  signedUrl: string | null,
  operatorName: string | null,
): MediaAsset {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    caption: row.caption,
    mediaKind: row.media_kind as MediaAsset["mediaKind"],
    capturedAt: row.captured_at,
    capturedAtTime: row.captured_at_time,
    developmentalStage: row.developmental_stage,
    viewpoint: row.viewpoint as MediaAsset["viewpoint"],
    imagingModality: row.imaging_modality as MediaAsset["imagingModality"],
    operatorId: row.operator_id,
    operatorName,
    scaleValue: row.scale_value,
    scaleUnit: row.scale_unit as MediaAsset["scaleUnit"],
    scaleNote: row.scale_note,
    scientificNote: row.scientific_note,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    signedUrl,
  };
}

/** Resolves operator_id -> display name for a batch of rows in one query,
 * same RLS-scoped client as everything else here - never a service-role
 * lookup, and never a cross-team leak since RLS on profiles already
 * confines the result to the caller's own visibility. */
async function resolveOperatorNames(
  client: Identity["client"],
  rows: Row[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.map((r) => r.operator_id).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return new Map();
  const { data } = await client
    .from("profiles")
    .select("id,display_name")
    .in("id", ids);
  return new Map(
    (data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ?? "—",
    ]),
  );
}

/** Candidates for the "image acquired by" selector - active profiles in
 * the caller's own team, RLS-scoped (the same can_access_team-backed
 * policy that already governs every other profiles read in this app). */
export async function listMediaOperatorCandidates(): Promise<
  { id: string; name: string }[]
> {
  const { client, profile } = await requireIdentity();
  const { data } = await client
    .from("profiles")
    .select("id,display_name")
    .eq("organization_id", profile.organization_id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_name", { ascending: true });
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.display_name as string | null) ?? "—",
  }));
}

export async function listMedia(
  targetTypeInput: string,
  targetIdInput: string,
  includeArchived: boolean,
): Promise<{ items: MediaAsset[]; canUpload: boolean } | { error: string }> {
  try {
    const targetType = targetTypeSchema.parse(targetTypeInput);
    const targetId = id.parse(targetIdInput);
    const { client } = await requireIdentity();
    const target = await resolveTarget(client, targetType, targetId);
    if (!target) return { error: "Vous n’avez pas accès à cette entité." };
    let query = client
      .from("media_assets")
      .select(rowSelect)
      .eq(targetColumn[targetType], targetId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    const operatorNames = await resolveOperatorNames(client, rows);
    const items = await Promise.all(
      rows.map(async (row) => {
        const path = await storagePathFor(client, row.id);
        const signedUrl = path ? await createMediaSignedUrl(path) : null;
        return toAsset(
          row,
          signedUrl,
          row.operator_id ? operatorNames.get(row.operator_id) ?? null : null,
        );
      }),
    );
    return { items, canUpload: !target.archived };
  } catch (error) {
    console.error("listMedia failed", error);
    return { error: "Impossible de charger les images." };
  }
}

/** The broader set of media sharing the same BIOLOGICAL target as
 * (targetType, targetId), used only for the opt-in temporal
 * timeline/comparison view - never for the default gallery grid, which
 * keeps listMedia's existing single-target scope unchanged.
 *
 * For parent_line/family/seed_lot the target row IS the biological
 * entity, so this is identical to listMedia's own scope. For
 * phenotype_evaluation, a single evaluation is a scoring EVENT, not the
 * physical specimen - phenotype_evaluations.phenotype_id is the actual
 * stable biological identity (audited against docs/database.md and the
 * phenotyping schema before deciding this), so every sibling evaluation
 * of the same phenotype is included. This never changes what a single
 * evaluation's own gallery/upload target is - it only widens what the
 * explicit "Comparer dans le temps" view additionally shows. */
export async function listComparableMedia(
  targetTypeInput: string,
  targetIdInput: string,
  includeArchived: boolean,
): Promise<{ items: MediaAsset[] } | { error: string }> {
  try {
    const targetType = targetTypeSchema.parse(targetTypeInput);
    const targetId = id.parse(targetIdInput);
    const { client } = await requireIdentity();
    const target = await resolveTarget(client, targetType, targetId);
    if (!target) return { error: "Vous n’avez pas accès à cette entité." };

    let query = client.from("media_assets").select(rowSelect);
    if (targetType === "phenotype_evaluation") {
      const { data: evaluation } = await client
        .from("phenotype_evaluations")
        .select("phenotype_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!evaluation)
        return { error: "Vous n’avez pas accès à cette entité." };
      const { data: siblings } = await client
        .from("phenotype_evaluations")
        .select("id")
        .eq("phenotype_id", evaluation.phenotype_id);
      const siblingIds = (siblings ?? []).map((s) => s.id as string);
      query = query.in(
        "phenotype_evaluation_id",
        siblingIds.length > 0 ? siblingIds : [targetId],
      );
    } else {
      query = query.eq(targetColumn[targetType], targetId);
    }
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    const operatorNames = await resolveOperatorNames(client, rows);
    const items = await Promise.all(
      rows.map(async (row) => {
        const path = await storagePathFor(client, row.id);
        const signedUrl = path ? await createMediaSignedUrl(path) : null;
        return toAsset(
          row,
          signedUrl,
          row.operator_id ? operatorNames.get(row.operator_id) ?? null : null,
        );
      }),
    );
    items.sort(compareTemporalAscending);
    return { items };
  } catch (error) {
    console.error("listComparableMedia failed", error);
    return { error: "Impossible de charger la chronologie." };
  }
}

async function storagePathFor(client: Identity["client"], mediaId: string) {
  const { data } = await client
    .from("media_assets")
    .select("storage_path")
    .eq("id", mediaId)
    .maybeSingle();
  return (data?.storage_path as string | undefined) ?? null;
}

const nullableTrimmed = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable(),
  );
const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? null : v), z.enum(values).nullable());

// Shared across upload and edit: every acquisition-metadata field is
// optional, and an empty form value always normalizes to null rather
// than an empty string - the database CHECK constraints reject
// zero-length strings for these columns.
const acquisitionMetadataFields = {
  caption: nullableTrimmed(500),
  mediaKind: nullableEnum(mediaKinds),
  capturedAt: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().date().nullable(),
  ),
  capturedAtTime: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/)
      .nullable(),
  ),
  developmentalStage: nullableTrimmed(60),
  viewpoint: nullableEnum(viewpoints),
  imagingModality: nullableEnum(imagingModalities),
  operatorId: z.preprocess((v) => (v === "" ? null : v), id.nullable()),
  scaleValue: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().positive().nullable(),
  ),
  scaleUnit: nullableEnum(scaleUnits),
  scaleNote: nullableTrimmed(255),
  scientificNote: nullableTrimmed(2000),
};
// A time without a date is meaningless (mirrors the database CHECK) -
// caught here too, as a proper field error, rather than a server 500.
function requireDateForTime(
  values: { capturedAt: string | null; capturedAtTime: string | null },
  ctx: z.RefinementCtx,
) {
  if (values.capturedAtTime && !values.capturedAt)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capturedAtTime"],
      message: "Une heure de prise de vue nécessite une date.",
    });
}

const uploadSchema = z
  .object({
    targetType: targetTypeSchema,
    targetId: id,
    ...acquisitionMetadataFields,
    isPrimary: z
      .union([z.literal("true"), z.literal("false"), z.null()])
      .transform((v) => v === "true"),
  })
  .superRefine(requireDateForTime);

export async function uploadMedia(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let uploadedPath: string | null = null;
  try {
    const values = uploadSchema.parse({
      targetType: form.get("target_type"),
      targetId: form.get("target_id"),
      caption: form.get("caption") ?? "",
      mediaKind: form.get("media_kind") ?? "",
      capturedAt: form.get("captured_at") ?? "",
      capturedAtTime: form.get("captured_at_time") ?? "",
      developmentalStage: form.get("developmental_stage") ?? "",
      viewpoint: form.get("viewpoint") ?? "",
      imagingModality: form.get("imaging_modality") ?? "",
      operatorId: form.get("operator_id") ?? "",
      scaleValue: form.get("scale_value") ?? "",
      scaleUnit: form.get("scale_unit") ?? "",
      scaleNote: form.get("scale_note") ?? "",
      scientificNote: form.get("scientific_note") ?? "",
      isPrimary: form.get("is_primary"),
    });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      return actionError(new Error("no file"), "Choisissez une image.");
    if (file.size > maxMediaBytes)
      return actionError(
        new Error("too large"),
        "Le fichier dépasse la limite de 10 Mo.",
      );
    const { client, profile } = await requireIdentity();
    const target = await resolveTarget(
      client,
      values.targetType,
      values.targetId,
    );
    if (!target)
      return actionError(
        new Error("forbidden"),
        "Vous n’avez pas accès à cette entité.",
      );
    if (target.archived)
      return actionError(
        new Error("archived"),
        "Cette entité est archivée : aucune nouvelle image ne peut y être ajoutée.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = sniffImageMimeType(bytes);
    if (!detectedMime || !acceptedMimeTypes.includes(detectedMime))
      return actionError(
        new Error("unsupported type"),
        "Format non pris en charge. Utilisez JPEG, PNG ou WebP.",
      );
    const dimensions = readImageDimensions(bytes, detectedMime);
    const { path } = buildMediaStoragePath({
      organizationId: profile.organization_id,
      programId: null,
      targetType: values.targetType,
      targetId: values.targetId,
      mimeType: detectedMime,
    });
    await uploadMediaObject(path, bytes, detectedMime);
    uploadedPath = path;
    const { error: insertError } = await client.from("media_assets").insert({
      [targetColumn[values.targetType]]: values.targetId,
      storage_path: path,
      original_filename: file.name.slice(0, 255) || "image",
      mime_type: detectedMime,
      byte_size: file.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      caption: values.caption,
      media_kind: values.mediaKind,
      captured_at: values.capturedAt,
      captured_at_time: values.capturedAtTime,
      developmental_stage: values.developmentalStage,
      viewpoint: values.viewpoint,
      imaging_modality: values.imagingModality,
      operator_id: values.operatorId,
      scale_value: values.scaleValue,
      scale_unit: values.scaleUnit,
      scale_note: values.scaleNote,
      scientific_note: values.scientificNote,
      created_by: profile.id,
    });
    if (insertError) throw insertError;
    if (values.isPrimary) {
      const { data: inserted } = await client
        .from("media_assets")
        .select("id")
        .eq("storage_path", path)
        .single();
      if (inserted)
        await client.rpc("set_media_primary", { target_media_id: inserted.id });
    }
    return actionSuccess("Image enregistrée.");
  } catch (error) {
    if (uploadedPath) await removeMediaObject(uploadedPath);
    return actionError(error, "L’image n’a pas pu être enregistrée.");
  }
}

const metadataSchema = z
  .object({
    mediaId: id,
    ...acquisitionMetadataFields,
  })
  .superRefine(requireDateForTime);

export async function updateMediaMetadata(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = metadataSchema.parse({
      mediaId: form.get("media_id"),
      caption: form.get("caption") ?? "",
      mediaKind: form.get("media_kind") ?? "",
      capturedAt: form.get("captured_at") ?? "",
      capturedAtTime: form.get("captured_at_time") ?? "",
      developmentalStage: form.get("developmental_stage") ?? "",
      viewpoint: form.get("viewpoint") ?? "",
      imagingModality: form.get("imaging_modality") ?? "",
      operatorId: form.get("operator_id") ?? "",
      scaleValue: form.get("scale_value") ?? "",
      scaleUnit: form.get("scale_unit") ?? "",
      scaleNote: form.get("scale_note") ?? "",
      scientificNote: form.get("scientific_note") ?? "",
    });
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("media_assets")
      .update({
        caption: values.caption,
        media_kind: values.mediaKind,
        captured_at: values.capturedAt,
        captured_at_time: values.capturedAtTime,
        developmental_stage: values.developmentalStage,
        viewpoint: values.viewpoint,
        imaging_modality: values.imagingModality,
        operator_id: values.operatorId,
        scale_value: values.scaleValue,
        scale_unit: values.scaleUnit,
        scale_note: values.scaleNote,
        scientific_note: values.scientificNote,
      })
      .eq("id", values.mediaId)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("not found");
    return actionSuccess("Informations mises à jour.");
  } catch (error) {
    return actionError(error, "La modification n’a pas pu être enregistrée.");
  }
}

export async function setMediaPrimaryAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const mediaId = id.parse(form.get("media_id"));
    const { client } = await requireIdentity();
    const { error } = await client.rpc("set_media_primary", {
      target_media_id: mediaId,
    });
    if (error) throw error;
    return actionSuccess("Image principale mise à jour.");
  } catch (error) {
    return actionError(
      error,
      "Impossible de définir cette image comme principale.",
    );
  }
}

async function setArchived(mediaId: string, archived: boolean) {
  const { client, profile } = await requireIdentity();
  const { data, error } = await client
    .from("media_assets")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? profile.id : null,
    })
    .eq("id", mediaId)
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("not found");
}

export async function archiveMediaAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await setArchived(id.parse(form.get("media_id")), true);
    return actionSuccess(
      "Image archivée. Elle reste consultable dans les archives.",
    );
  } catch (error) {
    return actionError(error, "L’image n’a pas pu être archivée.");
  }
}

export async function restoreMediaAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await setArchived(id.parse(form.get("media_id")), false);
    return actionSuccess("Image restaurée.");
  } catch (error) {
    return actionError(error, "L’image n’a pas pu être restaurée.");
  }
}

// ───────────────────────── Annotations ─────────────────────────
// Non-destructive overlay only - nothing here ever touches the source
// image bytes in Storage. Authorization is entirely derived from the
// underlying media_assets row (RLS on media_annotations joins back to
// it); this file never accepts or trusts an organization_id from the
// client for annotations, matching migration 000026's design.

type AnnotationRow = {
  id: string;
  media_asset_id: string;
  annotation_type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  label: string | null;
  created_at: string;
  archived_at: string | null;
};

function toAnnotation(row: AnnotationRow): MediaAnnotation {
  return {
    id: row.id,
    mediaAssetId: row.media_asset_id,
    annotationType: row.annotation_type as MediaAnnotation["annotationType"],
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    label: row.label,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

export async function listMediaAnnotations(
  mediaIdInput: string,
): Promise<MediaAnnotation[] | { error: string }> {
  try {
    const mediaId = id.parse(mediaIdInput);
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("media_annotations")
      .select(
        "id,media_asset_id,annotation_type,x,y,width,height,label,created_at,archived_at",
      )
      .eq("media_asset_id", mediaId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => toAnnotation(row as AnnotationRow));
  } catch (error) {
    console.error("listMediaAnnotations failed", error);
    return { error: "Impossible de charger les annotations." };
  }
}

const annotationSchema = z
  .object({
    mediaId: id,
    annotationType: z.enum(annotationTypes),
    x: z.coerce.number().min(0).max(1),
    y: z.coerce.number().min(0).max(1),
    width: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().min(0).max(1).nullable(),
    ),
    height: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().min(0).max(1).nullable(),
    ),
    label: nullableTrimmed(300),
  })
  .superRefine((values, ctx) => {
    const geometry = validateAnnotationGeometry({
      annotationType: values.annotationType,
      x: values.x,
      y: values.y,
      width: values.width,
      height: values.height,
      label: values.label,
    });
    if (!geometry.ok)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: geometry.error });
  });

export async function createAnnotationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = annotationSchema.parse({
      mediaId: form.get("media_id"),
      annotationType: form.get("annotation_type"),
      x: form.get("x"),
      y: form.get("y"),
      width: form.get("width") ?? "",
      height: form.get("height") ?? "",
      label: form.get("label") ?? "",
    });
    const { client, profile } = await requireIdentity();
    const { error } = await client.from("media_annotations").insert({
      media_asset_id: values.mediaId,
      annotation_type: values.annotationType,
      x: values.x,
      y: values.y,
      width: values.width,
      height: values.height,
      label: values.label,
      created_by: profile.id,
    });
    if (error) throw error;
    return actionSuccess("Annotation ajoutée.");
  } catch (error) {
    return actionError(error, "L’annotation n’a pas pu être enregistrée.");
  }
}

const editAnnotationSchema = z.object({
  annotationId: id,
  label: nullableTrimmed(300),
});

export async function updateAnnotationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const values = editAnnotationSchema.parse({
      annotationId: form.get("annotation_id"),
      label: form.get("label") ?? "",
    });
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("media_annotations")
      .update({ label: values.label })
      .eq("id", values.annotationId)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("not found");
    return actionSuccess("Annotation mise à jour.");
  } catch (error) {
    return actionError(error, "L’annotation n’a pas pu être modifiée.");
  }
}

async function setAnnotationArchived(annotationId: string, archived: boolean) {
  const { client, profile } = await requireIdentity();
  const { data, error } = await client
    .from("media_annotations")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? profile.id : null,
    })
    .eq("id", annotationId)
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("not found");
}

export async function archiveAnnotationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await setAnnotationArchived(id.parse(form.get("annotation_id")), true);
    return actionSuccess("Annotation retirée.");
  } catch (error) {
    return actionError(error, "L’annotation n’a pas pu être retirée.");
  }
}

export async function restoreAnnotationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await setAnnotationArchived(id.parse(form.get("annotation_id")), false);
    return actionSuccess("Annotation restaurée.");
  } catch (error) {
    return actionError(error, "L’annotation n’a pas pu être restaurée.");
  }
}
