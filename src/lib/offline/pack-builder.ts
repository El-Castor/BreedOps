import { computeConfigFingerprint } from "./config-fingerprint";
import type {
  OfflinePack,
  OfflinePhenotypeEntry,
  OfflineTraitDefinition,
} from "./types";

export interface PackBuilderInput {
  profileId: string;
  organizationId: string;
  programId: string;
  programCode: string;
  programName: string;
  trialId: string;
  trialCode: string;
  trialName: string;
  entries: OfflinePhenotypeEntry[];
  activeTraits: OfflineTraitDefinition[];
  /** Overridable only for deterministic tests - production callers always
   * let this default to "now". */
  snapshotCreatedAt?: string;
}

/** Pure: assembles the pack record and computes its configuration
 * fingerprint. The authenticated data fetch that supplies `entries` and
 * `activeTraits` lives in src/app/app/field-packs/actions.ts, scoped by
 * requireIdentity() + RLS - this function trusts its caller already did
 * that and never re-derives authorization itself. */
export function buildOfflinePack(input: PackBuilderInput): OfflinePack {
  return {
    packId: `${input.profileId}:${input.trialId}`,
    schemaVersion: 1,
    profileId: input.profileId,
    organizationId: input.organizationId,
    programId: input.programId,
    programCode: input.programCode,
    programName: input.programName,
    trialId: input.trialId,
    trialCode: input.trialCode,
    trialName: input.trialName,
    entries: input.entries,
    activeTraits: input.activeTraits,
    configFingerprint: computeConfigFingerprint(input.activeTraits),
    snapshotCreatedAt: input.snapshotCreatedAt ?? new Date().toISOString(),
  };
}

export type { OfflinePhenotypeEntry, OfflineTraitDefinition };
