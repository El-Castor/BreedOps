// Plain helper module (NOT "use server") - Next.js requires every export of
// a "use server" file to itself be an async Server Action, so this pure,
// synchronous FormData parser cannot live in actions.ts even though it is
// only ever used server-side (src/app/app/analytics/actions.ts and
// src/app/app/analytics/export/route.ts both import it).
import { z } from "zod";
import type { AnalyticsFilters } from "@/lib/analytics/types";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function splitCsv(value: FormDataEntryValue | null): string[] | null {
  if (!value || typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

const filtersSchema = z.object({
  programId: uuid,
  traitId: uuid,
  dateFrom: isoDate.nullable(),
  dateTo: isoDate.nullable(),
  familyIds: z.array(uuid).nullable(),
  seedLotIds: z.array(uuid).nullable(),
  blocks: z.array(z.string()).nullable(),
  replicates: z.array(z.number().int()).nullable(),
  locations: z.array(z.string()).nullable(),
  includeArchived: z.boolean(),
});

export function filtersFromFormData(form: FormData): AnalyticsFilters {
  return filtersSchema.parse({
    programId: form.get("program_id"),
    traitId: form.get("trait_id"),
    dateFrom: form.get("date_from") || null,
    dateTo: form.get("date_to") || null,
    familyIds: splitCsv(form.get("family_ids")),
    seedLotIds: splitCsv(form.get("seed_lot_ids")),
    blocks: splitCsv(form.get("blocks")),
    replicates: splitCsv(form.get("replicates"))?.map(Number) ?? null,
    locations: splitCsv(form.get("locations")),
    includeArchived: form.get("include_archived") === "1",
  });
}
