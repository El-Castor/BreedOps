import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStorageStatus,
  requestPersistentStorage,
} from "../src/lib/offline/storage-status";

describe("storage status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unsupported when navigator.storage is absent", async () => {
    vi.stubGlobal("navigator", {});
    const status = await getStorageStatus();
    expect(status).toEqual({
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      persisted: null,
    });
  });

  it("reports usage/quota/persisted exactly as the browser returns them", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1048576 }),
        persisted: vi.fn().mockResolvedValue(true),
      },
    });
    const status = await getStorageStatus();
    expect(status).toEqual({
      supported: true,
      usageBytes: 1024,
      quotaBytes: 1048576,
      persisted: true,
    });
  });

  it("never claims persistence was granted when persist() returns false", async () => {
    const persist = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("navigator", { storage: { persist } });
    const granted = await requestPersistentStorage();
    expect(granted).toBe(false);
    expect(persist).toHaveBeenCalled();
  });

  it("returns false (never throws, never assumes true) when persist() is unsupported", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    const granted = await requestPersistentStorage();
    expect(granted).toBe(false);
  });
});
