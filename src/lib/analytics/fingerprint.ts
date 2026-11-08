// Pure function only (deterministic hash) - no "server-only" guard so it
// stays directly unit-testable, same convention as src/lib/media/temporal.ts.
import { createHash } from "node:crypto";

export type FingerprintRow = {
  evaluationId: string;
  traitValueId: string;
  traitId: string;
  phenotypeId: string;
  evaluationDate: string | null;
  numericValue: number;
};

/** Deterministic sha256 hex digest over the exact observations that fed an
 * analysis (task §10). Rows are sorted by a stable key before hashing so
 * the digest never depends on database/query row order - only on which
 * rows, and which values, were actually used. Never includes a transient
 * signed URL or any presentation-only field. */
export function datasetFingerprint(rows: FingerprintRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.traitValueId < b.traitValueId
      ? -1
      : a.traitValueId > b.traitValueId
        ? 1
        : 0,
  );
  const hash = createHash("sha256");
  for (const row of sorted) {
    hash.update(
      [
        row.evaluationId,
        row.traitValueId,
        row.traitId,
        row.phenotypeId,
        row.evaluationDate ?? "",
        String(row.numericValue),
      ].join("|"),
    );
    hash.update("\n");
  }
  return hash.digest("hex");
}
