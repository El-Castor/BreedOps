import type { QrEntityType } from "./payload";

// Shared by both a server-only module (attach-breeding.ts) and a "use
// client" one (entity-inspector.tsx) - kept dependency-free and tiny so
// neither has to import the other.
export const BREEDING_KIND_TO_QR_TYPE: Record<
  "parent" | "cross" | "family" | "lot",
  QrEntityType
> = {
  parent: "parent",
  cross: "cross",
  family: "family",
  lot: "seed_lot",
};
