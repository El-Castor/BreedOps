import type { AcceptedMimeType } from "./types";

// The client's reported File.type is never trusted as the source of truth:
// the actual MIME type is derived from the first bytes of the file. Chosen
// deliberately small and dependency-free rather than pulling in an image
// processing library for three fixed signatures.
export function sniffImageMimeType(bytes: Uint8Array): AcceptedMimeType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

const extensionByMime: Record<AcceptedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionForMimeType(mime: AcceptedMimeType): string {
  return extensionByMime[mime];
}

/** Best-effort only: a failed or partial read must never block the upload. */
export function readImageDimensions(
  bytes: Uint8Array,
  mime: AcceptedMimeType,
): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return readPngDimensions(bytes);
    if (mime === "image/jpeg") return readJpegDimensions(bytes);
    if (mime === "image/webp") return readWebpDimensions(bytes);
  } catch {
    return null;
  }
  return null;
}

function readPngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // SOF0..SOF15 markers (excluding DHT/JPG/DAC) carry the frame dimensions.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    const length = view.getUint16(offset + 2);
    if (isSof) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      offset += 2;
      continue;
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width:
        (view.getUint8(24) |
          (view.getUint8(25) << 8) |
          (view.getUint8(26) << 16)) +
        1,
      height:
        (view.getUint8(27) |
          (view.getUint8(28) << 8) |
          (view.getUint8(29) << 16)) +
        1,
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
