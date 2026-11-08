/** V1 resource limits for Import/Export. Deliberately conservative: a single
 * server process parses the whole file in memory, so an unbounded workbook
 * could exhaust it. */
export const IMPORT_LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024, // 10 MiB
  maxWorksheets: 10,
  maxRows: 5000,
  maxColumns: 60,
} as const;

export class LimitExceededError extends Error {}

export function assertUploadSize(byteLength: number) {
  if (byteLength > IMPORT_LIMITS.maxUploadBytes) {
    throw new LimitExceededError(
      `Fichier trop volumineux (${(byteLength / (1024 * 1024)).toFixed(1)} Mo, maximum ${IMPORT_LIMITS.maxUploadBytes / (1024 * 1024)} Mo).`,
    );
  }
}
