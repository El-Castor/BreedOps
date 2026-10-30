import type { QrEntityType } from "./payload";

export const QR_ENTITY_TYPE_LABELS: Record<QrEntityType, string> = {
  parent: "Ligne parentale",
  cross: "Croisement",
  family: "Famille",
  seed_lot: "Lot de graines",
  inventory_item: "Article d’inventaire",
  inventory_lot: "Lot d’inventaire",
  equipment: "Équipement",
};
