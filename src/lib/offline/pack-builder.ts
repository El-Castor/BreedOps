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
  /** Authoritative PostgreSQL fingerprint returned together with the active
   * trait snapshot by offline_sync_program_configuration(). */
  configFingerprint: string;
  /** Overridable only for deterministic tests - production callers always
   * let this default to "now". */
  snapshotCreatedAt?: string;
}

/**
 * Pure pack assembler. Configuration fetching, authorization and fingerprint
 * calculation are deliberately outside this function: the authenticated
 * server action obtains activeTraits + configFingerprint atomically from
 * PostgreSQL before calling this builder.
 */
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
    configFingerprint: input.configFingerprint,
    snapshotCreatedAt: input.snapshotCreatedAt ?? new Date().toISOString(),
  };
}

export type { OfflinePhenotypeEntry, OfflineTraitDefinition };
