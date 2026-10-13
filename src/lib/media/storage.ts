import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { extensionForMimeType } from "./image-signature";
import type { AcceptedMimeType, MediaTargetType } from "./types";

export const mediaBucket = "breedops-media";
/** Short-lived on purpose: never persisted, regenerated on every read. */
export const signedUrlTtlSeconds = 300;

const targetSegment: Record<MediaTargetType, string> = {
  parent_line: "parent-line",
  family: "family",
  seed_lot: "seed-lot",
  phenotype_evaluation: "phenotype-evaluation",
};

// The object path is derived entirely from generated identifiers -- never
// from the uploaded filename -- so it carries no secret, email, username or
// collision risk. The original filename is kept only as metadata.
export function buildMediaStoragePath(params: {
  organizationId: string;
  programId: string | null;
  targetType: MediaTargetType;
  targetId: string;
  mimeType: AcceptedMimeType;
}) {
  const mediaId = randomUUID();
  const extension = extensionForMimeType(params.mimeType);
  const path = [
    "org",
    params.organizationId,
    "program",
    params.programId ?? "none",
    targetSegment[params.targetType],
    params.targetId,
    `${mediaId}.${extension}`,
  ].join("/");
  return { mediaId, path };
}

export async function uploadMediaObject(
  path: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(mediaBucket)
    .upload(path, Buffer.from(bytes), { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

/** Compensation: remove an uploaded object if the metadata insert that was
 * supposed to follow it never succeeded, so it never becomes an orphan. */
export async function removeMediaObject(path: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(mediaBucket).remove([path]);
  if (error)
    console.error("Plant Media orphan cleanup failed", { path, error });
}

export async function createMediaSignedUrl(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(mediaBucket)
    .createSignedUrl(path, signedUrlTtlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
