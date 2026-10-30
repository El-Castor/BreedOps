// Canonical BreedOps QR payload design (V2-01 — see agend.md). A QR code
// encodes only a deep link to BreedOps's own lookup resolver
// (/app/lookup?type=<entity type>&id=<uuid>) - never a secret, a service-role
// key, a session token, or a signed Storage URL. The link does not bypass
// authentication: it is gated by the same middleware as every other /app/*
// route, and the lookup resolver re-checks authorization server-side via the
// normal RLS-scoped query path (src/lib/qr/entities.ts) before showing
// anything. A QR code is purely an identifier/navigation mechanism.
//
// No "location" entry here: the current schema has no normalized location
// table, only free-text location columns on seed_lots/inventory_lots/
// equipment (see agend.md V2-01 for QR_LOCATION_SUPPORT).
export const QR_ENTITY_TYPES = [
  "parent",
  "cross",
  "family",
  "seed_lot",
  "inventory_item",
  "inventory_lot",
  "equipment",
] as const;

export type QrEntityType = (typeof QR_ENTITY_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isQrEntityType(value: unknown): value is QrEntityType {
  return (
    typeof value === "string" &&
    (QR_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Deterministic and stable: the same (type, id) pair always produces the
// exact same path/URL, forever, regardless of mutable display data (names,
// statuses, notes) - a printed label never goes stale as long as the row
// itself still exists.
export function buildLookupPath(type: QrEntityType, id: string): string {
  return `/app/lookup?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

export function buildLookupUrl(
  origin: string,
  type: QrEntityType,
  id: string,
): string {
  return `${origin}${buildLookupPath(type, id)}`;
}
