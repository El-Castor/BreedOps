import "server-only";
import QRCode from "qrcode";

// Renders a self-contained SVG string server-side - no canvas, no external
// QR generation API, no network call of any kind. The data encoded is
// always one of this app's own deterministic lookup URLs (see payload.ts),
// never anything secret.
export async function renderQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
