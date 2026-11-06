import { createHash } from "node:crypto";
import type { OfflineTraitDefinition } from "./types";

// Pure, framework-agnostic (no "server-only", no I/O) so the exact same
// algorithm runs both where a pack is built (authenticated server action,
// src/app/app/field-packs/actions.ts) and where it is re-verified at sync
// time (src/app/api/offline-sync/route.ts) - the two MUST agree bit-for-bit
// or every synchronized evaluation would spuriously read as CONFIG_CHANGED.
//
// Only fields that affect evaluation *validity* are included (V2-07 §15):
// trait identity/data type/bounds/precision/allowed values and the active
// module composition. Display-only fields (name, description, protocol
// text) are deliberately excluded so a wording tweak never invalidates
// every queued offline evaluation against that trait.

function normalizeTraitForFingerprint(trait: OfflineTraitDefinition) {
  return {
    traitId: trait.traitId,
    code: trait.code,
    dataType: trait.dataType,
    unit: trait.unit,
    minimumValue: trait.minimumValue,
    maximumValue: trait.maximumValue,
    decimalPlaces: trait.decimalPlaces,
    allowedValues: trait.allowedValues ? [...trait.allowedValues].sort() : null,
    moduleId: trait.moduleId,
  };
}

/** Deterministic across process/runtime: traits are sorted by traitId before
 * hashing so insertion order never changes the fingerprint. */
export function computeConfigFingerprint(
  activeTraits: OfflineTraitDefinition[],
): string {
  const normalized = activeTraits
    .map(normalizeTraitForFingerprint)
    .sort((a, b) => a.traitId.localeCompare(b.traitId));
  const canonical = JSON.stringify(normalized);
  return createHash("sha256").update(canonical).digest("hex");
}
