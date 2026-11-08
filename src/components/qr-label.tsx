import type { QrEntityType } from "@/lib/qr/payload";
import { QR_ENTITY_TYPE_LABELS } from "@/lib/qr/labels";

// Reusable printable QR label, used everywhere BreedOps shows a QR code
// (entity inspector, inventory/equipment rows, the lookup page, multi-label
// print sheets) - one implementation, not a separate one per module.
//
// The QR graphic itself (aria-hidden) is decorative to assistive tech: it
// only matters to a camera. The real "accessible text equivalent" this
// requirement calls for is the text block printed right beside it, which
// every sighted or screen-reader user reads identically - the same
// information the QR encodes a link to.
export function QrLabel({
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
    <div className="qr-label">
      <div
        className="qr-label-code"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="qr-label-text">
        <p className="qr-label-brand">BreedOps</p>
        <p className="qr-label-type">{QR_ENTITY_TYPE_LABELS[type]}</p>
        {code && <p className="qr-label-main-code">{code}</p>}
        {title && title !== code && <p className="qr-label-title">{title}</p>}
        {subtitle && <p className="qr-label-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
