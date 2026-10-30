"use client";

import { Icon } from "@/components/icons";

export function PrintLabelButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      <Icon name="print" size={14} />
      Imprimer
    </button>
  );
}
