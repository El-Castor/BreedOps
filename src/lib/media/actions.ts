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
  maxMediaBytes,
  mediaKinds,
  type MediaAsset,
  type MediaTargetType,
} from "./types";

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
  "id,original_filename,mime_type,byte_size,width,height,caption,media_kind,captured_at,is_primary,sort_order,created_at,archived_at";

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
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  archived_at: string | null;
};

function toAsset(row: Row, signedUrl: string | null): MediaAsset {
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
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    signedUrl,
  };
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
    const items = await Promise.all(
      rows.map(async (row) => {
        const path = await storagePathFor(client, row.id);
        const signedUrl = path ? await createMediaSignedUrl(path) : null;
        return toAsset(row, signedUrl);
      }),
    );
    return { items, canUpload: !target.archived };
  } catch (error) {
    console.error("listMedia failed", error);
    return { error: "Impossible de charger les images." };
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

const uploadSchema = z.object({
  targetType: targetTypeSchema,
  targetId: id,
  caption: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(500).nullable(),
  ),
  mediaKind: z.preprocess(
    (v) => (v === "" ? null : v),
    z.enum(mediaKinds).nullable(),
  ),
  capturedAt: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().date().nullable(),
  ),
  isPrimary: z
    .union([z.literal("true"), z.literal("false"), z.null()])
    .transform((v) => v === "true"),
});

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

const metadataSchema = z.object({
  mediaId: id,
  caption: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(500).nullable(),
  ),
  mediaKind: z.preprocess(
    (v) => (v === "" ? null : v),
    z.enum(mediaKinds).nullable(),
  ),
  capturedAt: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().date().nullable(),
  ),
});

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
    });
    const { client } = await requireIdentity();
    const { data, error } = await client
      .from("media_assets")
      .update({
        caption: values.caption,
        media_kind: values.mediaKind,
        captured_at: values.capturedAt,
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
