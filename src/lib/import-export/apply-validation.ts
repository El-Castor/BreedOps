import "server-only";
import { z } from "zod";
import { IMPORT_LIMITS } from "./limits";
import type { EntityField, EntitySpec } from "./entities";

export class ApplyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyValidationError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fieldSchema(
  field: Pick<EntityField, "type" | "maxLength" | "enumValues" | "label">,
) {
  let base: z.ZodTypeAny;
  switch (field.type) {
    case "text":
      base = z
        .string()
        .trim()
        .min(1)
        .max(field.maxLength ?? 2000);
      break;
    case "integer":
      base = z.number().int();
      break;
    case "numeric":
      base = z.number().finite();
      break;
    case "date":
      base = z
        .string()
        .regex(ISO_DATE, `${field.label} doit être au format AAAA-MM-JJ.`)
        .refine(
          (value) => !Number.isNaN(Date.parse(value)),
          `${field.label} n'est pas une date valide.`,
        );
      break;
    case "enum":
      base = z.enum((field.enumValues ?? []) as [string, ...string[]]);
      break;
  }
  return base.nullable().optional();
}

/**
 * Builds the server-side row schema for one entity's Apply batch. This is a
 * second, independent boundary from Preview: Preview only advises the UI,
 * it is never itself an authorization or validation check, so a client that
 * skips it (or calls applyImportAction directly with a hand-built payload)
 * must still be rejected here before anything reaches Postgres. `.strict()`
 * rejects any key the entity spec doesn't declare — a client cannot smuggle
 * an extra column into the RPC's JSONB payload this way.
 */
function buildRowSchema(spec: EntitySpec) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of spec.fields) shape[field.key] = fieldSchema(field);
  for (const reference of spec.references) {
    shape[reference.key] = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .optional();
  }
  return z.object(shape).strict();
}

export type ApplyRow = Record<string, string | number | null>;

/**
 * Validates a whole Apply batch: row count against IMPORT_LIMITS.maxRows,
 * every row against the entity's declared field set/types (never an
 * arbitrary client-supplied shape), and — only where it is unambiguous
 * without a database round-trip — requiredOnCreate fields. A row with no
 * business code at all can never match an existing row, so it is
 * necessarily a creation and its requiredOnCreate fields must be present;
 * a row that does carry a code might still resolve to an update, which only
 * the matching import_* Postgres function can determine, and that function
 * independently re-enforces the same requirement on the actual create path.
 * This is defense in depth, not a replacement for the RPC's own checks.
 */
export function validateApplyRows(
  spec: EntitySpec,
  rows: unknown[],
): ApplyRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApplyValidationError("Aucune ligne à importer.");
  }
  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new ApplyValidationError(
      `Le lot dépasse la limite de ${IMPORT_LIMITS.maxRows} lignes.`,
    );
  }

  const schema = buildRowSchema(spec);
  const validated: ApplyRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = schema.safeParse(rows[index]);
    if (!parsed.success) {
      throw new ApplyValidationError(
        `Ligne ${index + 1} : ${parsed.error.issues[0]?.message ?? "valeur invalide"}.`,
      );
    }
    const row = parsed.data as ApplyRow;

    const hasOwnCode = spec.codeField ? Boolean(row[spec.codeField]) : false;
    if (!hasOwnCode) {
      const missing = [
        ...spec.fields.filter((f) => f.requiredOnCreate && !row[f.key]),
        ...spec.references.filter((r) => r.requiredOnCreate && !row[r.key]),
      ];
      if (missing.length > 0) {
        throw new ApplyValidationError(
          `Ligne ${index + 1} : champ requis manquant (${missing.map((f) => f.label).join(", ")}).`,
        );
      }
    }
    validated.push(row);
  }
  return validated;
}
