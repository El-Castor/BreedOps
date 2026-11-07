// Storage durability (V2-07 §9). Browser storage is not guaranteed
// permanent by default - this wraps navigator.storage so the UI can show
// an honest estimate and request persistence as progressive enhancement,
// never claiming a guarantee the browser did not actually give.

export interface StorageStatusResult {
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** null when the browser does not support `navigator.storage.persisted()`
   * at all - distinct from `false` (asked, and not granted). */
  persisted: boolean | null;
}

export async function getStorageStatus(): Promise<StorageStatusResult> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      persisted: null,
    };
  }
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate
      ? navigator.storage.estimate()
      : Promise.resolve(undefined),
    navigator.storage.persisted
      ? navigator.storage.persisted()
      : Promise.resolve(null),
  ]);
  return {
    supported: true,
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null,
    persisted,
  };
}

/** Requests persistent storage and returns exactly what the browser
 * reports - never assumed true. A denial is never treated as a failure:
 * offline functionality must keep working regardless (V2-07 §9). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  return navigator.storage.persist();
}
