// Shared vocabulary for Plant Media. Validation and authorization stay
// server-side (src/lib/media/actions.ts); this file is just the shape.

export const mediaTargetTypes = [
  "parent_line",
  "family",
  "seed_lot",
  "phenotype_evaluation",
] as const;
export type MediaTargetType = (typeof mediaTargetTypes)[number];

export const mediaKinds = [
  "plant",
  "organ",
  "symptom",
  "seed",
  "harvest",
  "other",
] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const mediaKindLabels: Record<MediaKind, string> = {
  plant: "Plante",
  organ: "Organe",
  symptom: "Symptôme",
  seed: "Graine",
  harvest: "Récolte",
  other: "Autre",
};

export const acceptedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AcceptedMimeType = (typeof acceptedMimeTypes)[number];

export const maxMediaBytes = 10 * 1024 * 1024;

export type MediaAsset = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  mediaKind: MediaKind | null;
  capturedAt: string | null;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
  /** Short-lived; generated per request, never persisted. */
  signedUrl: string | null;
};
