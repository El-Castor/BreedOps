import { FormDrawer } from "@/components/form-drawer";
import { PrintLabelButton } from "@/components/print-label-button";
import { QrLabel } from "@/components/qr-label";
import type { QrEntityType } from "@/lib/qr/payload";

// Per-row "show QR / print label" trigger for surfaces that have no entity
// inspector of their own (inventory items/lots, equipment) - reuses the
// same QrLabel/PrintLabelButton building blocks the breeding entity
// inspector uses for its own QR section.
export function QrRowAction({
  type,
  svg,
  code,
  title,
  subtitle,
}: {
  type: QrEntityType;
  svg: string;
  code: string | null;
  title: string;
  subtitle?: string | null;
}) {
  return (
    <FormDrawer
      label="QR"
      title={`Code QR — ${title}`}
      icon="qr"
      variant="secondary"
    >
      <div className="print-area">
        <QrLabel
          type={type}
          svg={svg}
          code={code}
          title={title}
          subtitle={subtitle}
        />
        <PrintLabelButton />
      </div>
    </FormDrawer>
  );
}
