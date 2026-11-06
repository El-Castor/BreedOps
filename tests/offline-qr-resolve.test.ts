import { describe, expect, it } from "vitest";
import {
  parseQrInput,
  resolvePhenotypesByQr,
} from "../src/lib/offline/qr-resolve";
import { buildLookupPath, buildLookupUrl } from "../src/lib/qr/payload";
import type {
  OfflinePack,
  OfflinePhenotypeEntry,
} from "../src/lib/offline/types";

const SEED_LOT_ID = "11111111-2222-3333-4444-555555555555";

function pack(entries: OfflinePhenotypeEntry[]): OfflinePack {
  return {
    packId: "profile-1:trial-1",
    schemaVersion: 1,
    profileId: "profile-1",
    organizationId: "org-1",
    programId: "program-1",
    programCode: "PRG",
    programName: "Programme test",
    trialId: "trial-1",
    trialCode: "T1",
    trialName: "Essai test",
    entries,
    activeTraits: [],
    configFingerprint: "fingerprint-1",
    snapshotCreatedAt: "2026-11-06T10:00:00.000Z",
  };
}

describe("parseQrInput", () => {
  it("parses the full deep-link URL buildLookupUrl() produces", () => {
    const url = buildLookupUrl(
      "https://breedops.example",
      "seed_lot",
      SEED_LOT_ID,
    );
    expect(parseQrInput(url)).toEqual({
      entityType: "seed_lot",
      entityId: SEED_LOT_ID,
    });
  });

  it("parses a bare path/query (buildLookupPath())", () => {
    const path = buildLookupPath("family", SEED_LOT_ID);
    expect(parseQrInput(path)).toEqual({
      entityType: "family",
      entityId: SEED_LOT_ID,
    });
  });

  it("rejects an unknown entity type", () => {
    expect(
      parseQrInput(`/app/lookup?type=not_a_real_type&id=${SEED_LOT_ID}`),
    ).toBeNull();
  });

  it("rejects a non-UUID id", () => {
    expect(parseQrInput("/app/lookup?type=seed_lot&id=not-a-uuid")).toBeNull();
  });

  it("rejects empty/garbage input without throwing", () => {
    expect(parseQrInput("")).toBeNull();
    expect(parseQrInput("   ")).toBeNull();
    expect(parseQrInput("not a url at all but has spaces")).toBeNull();
  });
});

describe("resolvePhenotypesByQr", () => {
  it("matches only entries whose own qr association equals the parsed (type, id)", () => {
    const matching: OfflinePhenotypeEntry = {
      phenotypeId: "pheno-1",
      phenotypeCode: "P-001",
      label: "G1",
      qr: { entityType: "seed_lot", entityId: SEED_LOT_ID },
    };
    const otherType: OfflinePhenotypeEntry = {
      phenotypeId: "pheno-2",
      phenotypeCode: "P-002",
      label: "G2",
      qr: { entityType: "family", entityId: SEED_LOT_ID },
    };
    const noQr: OfflinePhenotypeEntry = {
      phenotypeId: "pheno-3",
      phenotypeCode: "P-003",
      label: "G3",
      qr: null,
    };
    const p = pack([matching, otherType, noQr]);
    const result = resolvePhenotypesByQr(p, {
      entityType: "seed_lot",
      entityId: SEED_LOT_ID,
    });
    expect(result).toEqual([matching]);
  });

  it("returns every entry sharing the same seed lot - a QR scan can narrow to several candidates", () => {
    const a: OfflinePhenotypeEntry = {
      phenotypeId: "pheno-1",
      phenotypeCode: "P-001",
      label: "G1",
      qr: { entityType: "seed_lot", entityId: SEED_LOT_ID },
    };
    const b: OfflinePhenotypeEntry = {
      phenotypeId: "pheno-2",
      phenotypeCode: "P-002",
      label: "G2",
      qr: { entityType: "seed_lot", entityId: SEED_LOT_ID },
    };
    const p = pack([a, b]);
    const result = resolvePhenotypesByQr(p, {
      entityType: "seed_lot",
      entityId: SEED_LOT_ID,
    });
    expect(result).toEqual([a, b]);
  });

  it("returns an empty array (never throws) for an entity type no entry carries", () => {
    const p = pack([
      {
        phenotypeId: "pheno-1",
        phenotypeCode: "P-001",
        label: "G1",
        qr: { entityType: "seed_lot", entityId: SEED_LOT_ID },
      },
    ]);
    expect(
      resolvePhenotypesByQr(p, {
        entityType: "equipment",
        entityId: SEED_LOT_ID,
      }),
    ).toEqual([]);
  });
});
