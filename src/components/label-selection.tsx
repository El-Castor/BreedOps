"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { QrEntityType } from "@/lib/qr/payload";

// Lets a registry page (breeding, inventory) select several rows - possibly
// of different QR entity types - and print them together on one sheet
// (/app/labels/print). Selection is page-local React state only: nothing
// persisted, nothing sent anywhere until the user actually follows the
// print link, which only ever carries entity type + id pairs (never a
// secret, never more than this page already shows).
function itemKey(type: QrEntityType, id: string) {
  return `${type}:${id}`;
}

type SelectionContextValue = {
  selected: Set<string>;
  toggle: (type: QrEntityType, id: string) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function LabelSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((type: QrEntityType, id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = itemKey(type, id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

function useLabelSelection() {
  const context = useContext(SelectionContext);
  if (!context)
    throw new Error("Label selection controls require a selection provider");
  return context;
}

export function LabelSelectionCheckbox({
  type,
  id,
  label,
}: {
  type: QrEntityType;
  id: string;
  label: string;
}) {
  const { selected, toggle } = useLabelSelection();
  const key = itemKey(type, id);
  return (
    <input
      type="checkbox"
      checked={selected.has(key)}
      onChange={() => toggle(type, id)}
      aria-label={`Sélectionner ${label} pour l’impression d’étiquettes`}
    />
  );
}

export function LabelPrintBar() {
  const { selected } = useLabelSelection();
  if (selected.size === 0) return null;
  const items = [...selected].join(",");
  return (
    <div className="label-print-bar" role="status">
      <span>
        {selected.size} étiquette{selected.size > 1 ? "s" : ""} sélectionnée
        {selected.size > 1 ? "s" : ""}
      </span>
      <Link
        className="button-link"
        href={`/app/labels/print?items=${encodeURIComponent(items)}`}
      >
        Imprimer les étiquettes
      </Link>
    </div>
  );
}
