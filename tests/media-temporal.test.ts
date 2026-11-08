import { describe, expect, it } from "vitest";
import {
  capturePrecision,
  captureInstant,
  compareTemporalAscending,
  compareTemporalDescending,
} from "../src/lib/media/temporal";

describe("capturePrecision", () => {
  it("is unknown when no capture date is set", () => {
    expect(
      capturePrecision({
        capturedAt: null,
        capturedAtTime: null,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("unknown");
  });

  it("is date when only the capture date is known", () => {
    expect(
      capturePrecision({
        capturedAt: "2026-05-01",
        capturedAtTime: null,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("date");
  });

  it("is datetime when both capture date and time are known", () => {
    expect(
      capturePrecision({
        capturedAt: "2026-05-01",
        capturedAtTime: "10:30:00",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("datetime");
  });
});

describe("captureInstant", () => {
  it("uses the precise timestamp when date and time are both known", () => {
    const result = captureInstant({
      capturedAt: "2026-05-01",
      capturedAtTime: "10:30:00",
      createdAt: "2099-01-01T00:00:00Z",
    });
    expect(result).toEqual({
      instant: "2026-05-01T10:30:00",
      precision: "datetime",
    });
  });

  it("falls back to midnight on the capture date when only the date is known", () => {
    const result = captureInstant({
      capturedAt: "2026-05-01",
      capturedAtTime: null,
      createdAt: "2099-01-01T00:00:00Z",
    });
    expect(result).toEqual({
      instant: "2026-05-01T00:00:00",
      precision: "date",
    });
  });

  it("falls back to created_at only when no capture date exists at all", () => {
    const result = captureInstant({
      capturedAt: null,
      capturedAtTime: null,
      createdAt: "2026-01-02T03:04:05Z",
    });
    expect(result).toEqual({
      instant: "2026-01-02T03:04:05Z",
      precision: "unknown",
    });
  });
});

describe("temporal ordering rule: precise timestamp > date > created_at fallback", () => {
  const precise = {
    capturedAt: "2026-06-01",
    capturedAtTime: "08:00:00",
    createdAt: "2020-01-01T00:00:00Z",
  };
  const dateOnly = {
    capturedAt: "2026-06-02",
    capturedAtTime: null,
    createdAt: "2020-01-01T00:00:00Z",
  };
  const undated = {
    capturedAt: null,
    capturedAtTime: null,
    createdAt: "2027-01-01T00:00:00Z",
  };

  it("orders ascending (oldest first) by precise instant, regardless of upload order", () => {
    const sorted = [dateOnly, precise, undated].sort(compareTemporalAscending);
    expect(sorted).toEqual([precise, dateOnly, undated]);
  });

  it("orders dated images in reverse for descending, but still trails every undated image last", () => {
    const sorted = [dateOnly, precise, undated].sort(compareTemporalDescending);
    expect(sorted).toEqual([dateOnly, precise, undated]);
  });

  it("a known date always sorts before an undated image, even if the undated image was uploaded earlier", () => {
    const earlyUpload = {
      capturedAt: null,
      capturedAtTime: null,
      createdAt: "2000-01-01T00:00:00Z",
    };
    const laterKnownDate = {
      capturedAt: "2026-01-01",
      capturedAtTime: null,
      createdAt: "2030-01-01T00:00:00Z",
    };
    expect(compareTemporalAscending(earlyUpload, laterKnownDate)).toBe(1);
    expect(compareTemporalDescending(earlyUpload, laterKnownDate)).toBe(1);
  });

  it("is stable (returns 0) for two images with the exact same resolved instant", () => {
    const a = {
      capturedAt: "2026-01-01",
      capturedAtTime: null,
      createdAt: "x",
    };
    const b = {
      capturedAt: "2026-01-01",
      capturedAtTime: null,
      createdAt: "y",
    };
    expect(compareTemporalAscending(a, b)).toBe(0);
  });
});
