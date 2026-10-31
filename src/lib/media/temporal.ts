// Pure functions only - no I/O, deterministic, unit-testable.
//
// Temporal ordering rule (documented once, implemented once):
//   1. precise capture timestamp (captured_at date + captured_at_time)
//   2. capture date alone, treated as that date's midnight
//   3. created_at (upload time) - last resort only, for images with no
//      capture date at all; the UI must always label these "Date inconnue"
//      rather than silently presenting an upload time as a capture time.
import type { CapturePrecision } from "./types";

export type TemporalInput = {
  capturedAt: string | null;
  capturedAtTime: string | null;
  createdAt: string;
};

export type CaptureInstant = {
  /** ISO instant usable for sorting/display. */
  instant: string;
  precision: CapturePrecision;
};

export function capturePrecision(item: TemporalInput): CapturePrecision {
  if (!item.capturedAt) return "unknown";
  return item.capturedAtTime ? "datetime" : "date";
}

/** Resolves the single instant used for sorting and display, and the
 * precision it was derived at, per the documented ordering rule above. */
export function captureInstant(item: TemporalInput): CaptureInstant {
  const precision = capturePrecision(item);
  if (precision === "datetime") {
    return { instant: `${item.capturedAt}T${item.capturedAtTime}`, precision };
  }
  if (precision === "date") {
    return { instant: `${item.capturedAt}T00:00:00`, precision };
  }
  return { instant: item.createdAt, precision };
}

// "created_at" is a last-resort fallback for images with no capture date
// at all, not a real capture time - an undated image must never be
// interleaved among dated ones as if its upload time were a genuine
// chronological position. Both orderings below therefore always sort
// every undated image after every dated one, in either direction; only
// within each of those two groups does the actual instant decide order.
function unknownRank(item: TemporalInput): 0 | 1 {
  return capturePrecision(item) === "unknown" ? 1 : 0;
}

/** Ascending (oldest first) - for the chronological timeline. */
export function compareTemporalAscending(
  a: TemporalInput,
  b: TemporalInput,
): number {
  const rankDiff = unknownRank(a) - unknownRank(b);
  if (rankDiff !== 0) return rankDiff;
  const left = captureInstant(a).instant;
  const right = captureInstant(b).instant;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Descending (newest first) - for the default gallery grid. Undated
 * images still trail every dated one, even though dated ones are
 * otherwise reversed. */
export function compareTemporalDescending(
  a: TemporalInput,
  b: TemporalInput,
): number {
  const rankDiff = unknownRank(a) - unknownRank(b);
  if (rankDiff !== 0) return rankDiff;
  return compareTemporalAscending(b, a);
}
