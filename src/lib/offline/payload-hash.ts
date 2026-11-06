// Cross-environment (browser + Node) payload hashing for the offline sync
// idempotency contract (V2-07 §13): the client hashes a queued operation's
// payload once at creation time and sends both the payload and the hash;
// the server (src/app/api/offline-sync/route.ts, and the
// submit_offline_phenotype_evaluation() SQL wrapper it calls) recomputes
// the same hash over the payload it actually received and compares, so a
// retry of the exact same operation is distinguished from a reused
// operationId carrying a different payload
// (IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD). Uses Web Crypto
// (`crypto.subtle`), available natively in both browsers and the Node
// runtimes this app's server code and Vitest tests run under - no extra
// dependency, no divergent client/server implementation to keep in sync.

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
