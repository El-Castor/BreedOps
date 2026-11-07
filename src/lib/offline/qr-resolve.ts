import { isQrEntityType, isUuid, type QrEntityType } from "../qr/payload";
import type { OfflinePack, OfflinePhenotypeEntry } from "./types";

// Local resolution of the *existing* V2-01 QR deep-link format (V2-07 §29)
// - never a second, incompatible QR format, and never a server round-trip
// just to identify an already-prepared entity while offline. BreedOps has
// no in-app camera scanner today (online or offline); the supported flow
// is the phone's own camera app decoding the physical label and the user
// sharing/pasting the resulting link (or its bare query) here - building a
// new scanner is explicitly out of this milestone's scope.

export interface ParsedQrInput {
  entityType: QrEntityType;
  entityId: string;
}

/** Accepts the exact shape buildLookupUrl()/buildLookupPath() produce
 * (src/lib/qr/payload.ts) - a full URL or a bare path/query string.
 * `URL`'s base argument is only there to parse a relative input; the
 * scanned origin itself is never trusted or inspected. */
export function parseQrInput(raw: string): ParsedQrInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let type: string | null;
  let id: string | null;
  try {
    const url = new URL(trimmed, "https://breedops.invalid");
    type = url.searchParams.get("type");
    id = url.searchParams.get("id");
  } catch {
    return null;
  }
  if (!isQrEntityType(type) || !isUuid(id)) return null;
  return { entityType: type, entityId: id };
}

/** Matches only against associations already captured into the pack at
 * preparation time (src/app/app/field-packs/actions.ts's resolveQr) -
 * never anything that would require a network call to resolve. A QR
 * entity type with no such association on any entry (e.g. "equipment")
 * simply matches nothing, which is correct: this pack carries no such
 * association to resolve against. */
export function resolvePhenotypesByQr(
  pack: OfflinePack,
  parsed: ParsedQrInput,
): OfflinePhenotypeEntry[] {
  return pack.entries.filter(
    (entry) =>
      entry.qr?.entityType === parsed.entityType &&
      entry.qr?.entityId === parsed.entityId,
  );
}
