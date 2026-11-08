// Cross-environment (browser + Node) payload hashing for the offline sync
// request contract. The client computes this hash when creating an outbox
// operation and the Next.js sync endpoint recomputes it from the payload it
// actually receives. This rejects corrupted or forged payload/hash pairs
// before the mutation RPC is invoked.
//
// This hash is NOT the database authority. PostgreSQL independently derives
// its own canonical SHA-256 from the mutation payload before creating or
// comparing an offline_sync_receipts entry. This second layer prevents a
// caller that bypasses the Next.js endpoint and invokes the authenticated RPC
// directly from controlling the idempotency receipt hash.

/** Recursively sorts object keys so semantically-identical payloads hash
 * identically regardless of property insertion order. Arrays keep their
 * order (it is meaningful), only object keys are sorted. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => [key, canonicalize(val)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

export async function computePayloadHash(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(canonicalize(payload));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
