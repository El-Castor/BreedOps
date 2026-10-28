import type { EntityField, EntitySpec } from "./entities";

export class HeaderError extends Error {}

/** Takes the first non-blank row as the header row, trims each header, and
 * rejects duplicate (case-insensitive) headers outright rather than
 * silently keeping only one column's data under an ambiguous name. */
export function detectHeaders(rows: string[][]): {
  headers: string[];
  dataRows: string[][];
} {
  const firstNonBlank = rows.findIndex((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (firstNonBlank === -1)
    throw new HeaderError("Le fichier ne contient aucune donnée.");
  const headers = rows[firstNonBlank].map((cell) => cell.trim());
  const seen = new Map<string, number>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (key === "") continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  if (duplicates.length > 0) {
    throw new HeaderError(
      `Colonnes en double dans l'en-tête : ${duplicates.join(", ")}.`,
    );
  }
  return { headers, dataRows: rows.slice(firstNonBlank + 1) };
}

export type ColumnMapping = Record<string, number | null>;

/** A best-effort default mapping from header text to field keys, matching a
 * field's key or label case-insensitively (accents/punctuation-insensitive
 * enough for common spreadsheet headers). The user can always override it —
 * this only seeds the mapping step, it never silently decides it. */
export function suggestMapping(
  headers: string[],
  fields: EntityField[],
): ColumnMapping {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const normalizedHeaders = headers.map(normalize);
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    // A label like "Code (Cross ID)" also recognizes a header of just the
    // parenthesized business-code term, since that's the exact terminology
    // PROMPT.md's own idempotency keys use and what a user is likely to type.
    const bracketed = /\(([^)]+)\)/.exec(field.label)?.[1];
    const candidates = [
      normalize(field.key),
      normalize(field.label),
      ...(bracketed ? [normalize(bracketed)] : []),
    ];
    const index = normalizedHeaders.findIndex((header) =>
      candidates.includes(header),
    );
    mapping[field.key] = index === -1 ? null : index;
  }
  return mapping;
}

export type NormalizedValue =
  | { ok: true; value: string | number | null }
  | { ok: false; error: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeField(
  raw: string,
  field: EntityField,
): NormalizedValue {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  switch (field.type) {
    case "text":
      if (field.maxLength && trimmed.length > field.maxLength) {
        return {
          ok: false,
          error: `${field.label} dépasse ${field.maxLength} caractères.`,
        };
      }
      return { ok: true, value: trimmed };
    case "integer": {
      const value = Number(trimmed);
      if (!Number.isInteger(value))
        return {
          ok: false,
          error: `${field.label} doit être un nombre entier.`,
        };
      return { ok: true, value };
    }
    case "numeric": {
      const value = Number(trimmed);
      if (!Number.isFinite(value))
        return { ok: false, error: `${field.label} doit être un nombre.` };
      return { ok: true, value };
    }
    case "date": {
      // Accept ISO (2026-01-31) directly; accept d/m/Y or d-m-Y as a common
      // spreadsheet export shape and normalize to ISO for the server.
      if (DATE_PATTERN.test(trimmed)) {
        return Number.isNaN(Date.parse(trimmed))
          ? { ok: false, error: `${field.label} n'est pas une date valide.` }
          : { ok: true, value: trimmed };
      }
      const europeanMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
      if (europeanMatch) {
        const [, day, month, year] = europeanMatch;
        const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        return Number.isNaN(Date.parse(iso))
          ? { ok: false, error: `${field.label} n'est pas une date valide.` }
          : { ok: true, value: iso };
      }
      return {
        ok: false,
        error: `${field.label} doit être au format AAAA-MM-JJ.`,
      };
    }
    case "enum": {
      if (!field.enumValues?.includes(trimmed)) {
        return {
          ok: false,
          error: `${field.label} doit être l'une des valeurs : ${field.enumValues?.join(", ")}.`,
        };
      }
      return { ok: true, value: trimmed };
    }
  }
}

export type RowFieldErrors = { field: string; message: string }[];

/** Maps and normalizes one raw spreadsheet row into the RPC's JSON row
 * shape, per the entity spec and the user's column mapping. Field-level
 * errors are collected rather than thrown so the preview step can report
 * every problem on a row at once. */
export function buildRowPayload(
  spec: EntitySpec,
  mapping: ColumnMapping,
  rawRow: string[],
): { payload: Record<string, string | number | null>; errors: RowFieldErrors } {
  const payload: Record<string, string | number | null> = {};
  const errors: RowFieldErrors = [];
  const allFields = [
    ...spec.fields,
    ...spec.references.map((reference) => ({
      key: reference.key,
      label: reference.label,
      type: "text" as const,
      requiredOnCreate: reference.requiredOnCreate,
      immutable: true,
    })),
  ];

  for (const field of allFields) {
    const columnIndex = mapping[field.key];
    const raw =
      columnIndex === null || columnIndex === undefined
        ? ""
        : rawRow[columnIndex] ?? "";
    const normalized = normalizeField(raw, field);
    if (!normalized.ok) {
      errors.push({ field: field.key, message: normalized.error });
      continue;
    }
    payload[field.key] = normalized.value;
  }
  return { payload, errors };
}
