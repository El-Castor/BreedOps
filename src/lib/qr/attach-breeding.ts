import "server-only";
import type { BreedingEntityDetail } from "@/components/entity-inspector";
import { buildLookupUrl } from "./payload";
import { BREEDING_KIND_TO_QR_TYPE } from "./breeding-kind";
import { renderQrSvg } from "./svg";

// buildBreedingEntityDetails() (src/lib/breeding-entity-details.ts) stays a
// pure, synchronous function - this is a separate pass the breeding page
// runs afterwards to attach each entity's printable QR label, since
// rendering an SVG is an async, server-only step.
export async function attachQr<T extends BreedingEntityDetail>(
  details: T[],
  origin: string,
): Promise<(T & { qr: { url: string; svg: string } })[]> {
  return Promise.all(
    details.map(async (detail) => {
      const url = buildLookupUrl(
        origin,
        BREEDING_KIND_TO_QR_TYPE[detail.kind],
        detail.id,
      );
      const svg = await renderQrSvg(url);
      return { ...detail, qr: { url, svg } };
    }),
  );
}
