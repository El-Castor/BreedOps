// Pure validation only - mirrors the database CHECK constraints in
// migration 000026 exactly, so a bad submission gets a clear French
// message before ever reaching Postgres. The database constraints remain
// the actual authority: this is a convenience layer, not a replacement.
import type { AnnotationType } from "./types";

export type AnnotationGeometryInput = {
  annotationType: AnnotationType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  label: string | null;
};

export type AnnotationValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const unit = (value: number) => value >= 0 && value <= 1;

export function validateAnnotationGeometry(
  input: AnnotationGeometryInput,
): AnnotationValidationResult {
  if (!unit(input.x) || !unit(input.y))
    return {
      ok: false,
      error: "La position doit rester à l’intérieur de l’image.",
    };

  if (input.annotationType === "rectangle") {
    if (input.width == null || input.height == null)
      return {
        ok: false,
        error: "Une zone nécessite une largeur et une hauteur.",
      };
    if (!unit(input.width) || !unit(input.height))
      return { ok: false, error: "La zone dépasse les dimensions de l’image." };
    if (input.x + input.width > 1 || input.y + input.height > 1)
      return {
        ok: false,
        error: "La zone ne doit pas dépasser les bords de l’image.",
      };
  } else if (input.width != null || input.height != null) {
    return {
      ok: false,
      error: "Un point ou un texte n’a pas de largeur ni de hauteur.",
    };
  }

  if (input.annotationType === "text" && !input.label?.trim())
    return {
      ok: false,
      error: "Une annotation de type texte nécessite un texte.",
    };

  if (input.label != null) {
    const length = input.label.trim().length;
    if (length === 0 && input.annotationType !== "text")
      return {
        ok: false,
        error: "Le texte de l’annotation ne peut pas être vide.",
      };
    if (length > 300)
      return {
        ok: false,
        error: "Le texte de l’annotation dépasse 300 caractères.",
      };
  }

  return { ok: true };
}
