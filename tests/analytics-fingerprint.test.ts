import { describe, expect, it } from "vitest";
import {
  datasetFingerprint,
  type FingerprintRow,
} from "../src/lib/analytics/fingerprint";

const row = (traitValueId: string, numericValue: number): FingerprintRow => ({
  evaluationId: `eval-${traitValueId}`,
  traitValueId,
  traitId: "trait-1",
  phenotypeId: "pheno-1",
  evaluationDate: "2026-01-01",
  numericValue,
});

describe("dataset fingerprint", () => {
  it("is deterministic for the same rows", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 3)];
    expect(datasetFingerprint(rows)).toBe(datasetFingerprint(rows));
  });

  it("is independent of input row order (canonical sort before hashing)", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 3)];
    const shuffled = [rows[2], rows[0], rows[1]];
    expect(datasetFingerprint(rows)).toBe(datasetFingerprint(shuffled));
  });

  it("changes when a single value changes", () => {
    const original = [row("a", 1), row("b", 2)];
    const changed = [row("a", 1), row("b", 999)];
    expect(datasetFingerprint(original)).not.toBe(datasetFingerprint(changed));
  });

  it("changes when a row is added or removed", () => {
    const base = [row("a", 1), row("b", 2)];
    const withExtra = [...base, row("c", 3)];
    expect(datasetFingerprint(base)).not.toBe(datasetFingerprint(withExtra));
  });

  it("is a 64-character lowercase hex sha256 digest", () => {
    const digest = datasetFingerprint([row("a", 1)]);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
