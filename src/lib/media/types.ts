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

export const viewpoints = [
  "top",
  "side",
  "front",
  "back",
  "macro",
  "microscope",
  "other",
] as const;
export type Viewpoint = (typeof viewpoints)[number];
export const viewpointLabels: Record<Viewpoint, string> = {
  top: "Dessus",
  side: "Côté",
  front: "Face",
  back: "Dos",
  macro: "Macro",
  microscope: "Microscope",
  other: "Autre",
};

export const imagingModalities = [
  "visible",
  "fluorescence",
  "microscopy",
  "scanner",
  "other",
] as const;
export type ImagingModality = (typeof imagingModalities)[number];
export const imagingModalityLabels: Record<ImagingModality, string> = {
  visible: "Lumière visible",
  fluorescence: "Fluorescence",
  microscopy: "Microscopie",
  scanner: "Scanner",
  other: "Autre",
};

export const scaleUnits = ["mm", "cm", "m", "px"] as const;
export type ScaleUnit = (typeof scaleUnits)[number];

/** Known date, known date+time, or no capture date at all. Never inferred
 * from upload time - see src/lib/media/temporal.ts for how each is ordered. */
export type CapturePrecision = "unknown" | "date" | "datetime";

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
  capturedAtTime: string | null;
  developmentalStage: string | null;
  viewpoint: Viewpoint | null;
  imagingModality: ImagingModality | null;
  operatorId: string | null;
  operatorName: string | null;
  scaleValue: number | null;
  scaleUnit: ScaleUnit | null;
  scaleNote: string | null;
  scientificNote: string | null;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  archivedAt: string | null;
  /** Short-lived; generated per request, never persisted. */
  signedUrl: string | null;
};

export const annotationTypes = ["point", "rectangle", "text"] as const;
export type AnnotationType = (typeof annotationTypes)[number];
export const annotationTypeLabels: Record<AnnotationType, string> = {
  point: "Point",
  rectangle: "Zone",
  text: "Texte",
};

export type MediaAnnotation = {
  id: string;
  mediaAssetId: string;
  annotationType: AnnotationType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  label: string | null;
  createdAt: string;
  archivedAt: string | null;
};
