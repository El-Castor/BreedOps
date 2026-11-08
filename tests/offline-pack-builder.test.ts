import { describe, expect, it } from "vitest";
import { buildOfflinePack } from "../src/lib/offline/pack-builder";
import type {
  OfflinePhenotypeEntry,
  OfflineTraitDefinition,
} from "../src/lib/offline/types";

const trait: OfflineTraitDefinition = {
  traitId: "t1",
  code: "HEIGHT",
  name: "Hauteur",
  description: null,
  category: "morphology",
  dataType: "numeric",
  unit: "cm",
  minimumValue: 0,
  maximumValue: 300,
  decimalPlaces: 1,
  allowedValues: null,
  direction: "higher_is_better",
  targetValue: null,
  protocol: null,
  moduleId: "module-1",
  moduleName: "Agronomie",
  moduleOrder: 1,
  traitOrder: 1,
};

const entry: OfflinePhenotypeEntry = {
  phenotypeId: "pheno-1",
  phenotypeCode: "P-001",
  label: "G1 — Lignée X (Site A)",
  qr: { entityType: "seed_lot", entityId: "lot-1" },
};

describe("buildOfflinePack", () => {
  const configFingerprint = "authoritative-db-fingerprint";
  it("derives a profile-scoped packId and preserves the authoritative config fingerprint", () => {
    const pack = buildOfflinePack({
      profileId: "profile-1",
      organizationId: "org-1",
      programId: "program-1",
      programCode: "PRG",
      programName: "Programme test",
      trialId: "trial-1",
      trialCode: "T1",
      trialName: "Essai test",
      entries: [entry],
      activeTraits: [trait],
      configFingerprint,
      snapshotCreatedAt: "2026-11-06T10:00:00.000Z",
    });

    expect(pack.packId).toBe("profile-1:trial-1");
    expect(pack.schemaVersion).toBe(1);
    expect(pack.entries).toEqual([entry]);
    expect(pack.activeTraits).toEqual([trait]);
    expect(pack.configFingerprint).toBe(configFingerprint);
    expect(pack.snapshotCreatedAt).toBe("2026-11-06T10:00:00.000Z");
  });

  it("defaults snapshotCreatedAt to now when not provided", () => {
    const before = Date.now();
    const pack = buildOfflinePack({
      profileId: "profile-1",
      organizationId: "org-1",
      programId: "program-1",
      programCode: "PRG",
      programName: "Programme test",
      trialId: "trial-1",
      trialCode: "T1",
      trialName: "Essai test",
      entries: [],
      activeTraits: [],
      configFingerprint,
    });
    const snapshotMs = new Date(pack.snapshotCreatedAt).getTime();
    expect(snapshotMs).toBeGreaterThanOrEqual(before);
    expect(snapshotMs).toBeLessThanOrEqual(Date.now());
  });

  it("two different trials for the same profile never collide on packId", () => {
    const a = buildOfflinePack({
      profileId: "profile-1",
      organizationId: "org-1",
      programId: "program-1",
      programCode: "PRG",
      programName: "Programme test",
      trialId: "trial-1",
      trialCode: "T1",
      trialName: "Essai 1",
      entries: [],
      activeTraits: [],
      configFingerprint,
    });
    const b = buildOfflinePack({
      profileId: "profile-1",
      organizationId: "org-1",
      programId: "program-1",
      programCode: "PRG",
      programName: "Programme test",
      trialId: "trial-2",
      trialCode: "T2",
      trialName: "Essai 2",
      entries: [],
      activeTraits: [],
      configFingerprint,
    });
    expect(a.packId).not.toBe(b.packId);
  });
});
