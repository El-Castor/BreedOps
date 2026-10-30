import { describe, expect, it } from "vitest";
import {
  QR_ENTITY_TYPES,
  buildLookupPath,
  buildLookupUrl,
  isQrEntityType,
  isUuid,
} from "../src/lib/qr/payload";
import { safeNextPath } from "../src/lib/safe-next-path";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

describe("QR canonical payload", () => {
  it("supports exactly the 7 documented entity types", () => {
    expect([...QR_ENTITY_TYPES].sort()).toEqual(
      [
        "parent",
        "cross",
        "family",
        "seed_lot",
        "inventory_item",
        "inventory_lot",
        "equipment",
      ].sort(),
    );
  });

  it("accepts every supported entity type", () => {
    for (const type of QR_ENTITY_TYPES) expect(isQrEntityType(type)).toBe(true);
  });

  it("rejects an unsupported or malformed entity type", () => {
    for (const bad of [
      "location",
      "parents",
      "Parent",
      "",
      " parent",
      null,
      undefined,
      42,
      { type: "parent" },
    ])
      expect(isQrEntityType(bad)).toBe(false);
  });

  it("accepts a well-formed UUID in any case", () => {
    expect(isUuid(VALID_UUID)).toBe(true);
    expect(isUuid(VALID_UUID.toUpperCase())).toBe(true);
  });

  it("rejects a malformed UUID", () => {
    for (const bad of [
      "not-a-uuid",
      "11111111-2222-3333-4444-55555555555", // one char short
      "11111111-2222-3333-4444-5555555555555", // one char long
      "11111111222233334444555555555555", // no dashes
      "'; DROP TABLE organizations; --",
      "",
      null,
      undefined,
      123,
    ])
      expect(isUuid(bad)).toBe(false);
  });

  it("builds a deterministic, stable lookup path for the same (type, id)", () => {
    const first = buildLookupPath("seed_lot", VALID_UUID);
    const second = buildLookupPath("seed_lot", VALID_UUID);
    expect(first).toBe(second);
    expect(first).toBe(`/app/lookup?type=seed_lot&id=${VALID_UUID}`);
  });

  it("builds an absolute lookup URL from an origin, type and id", () => {
    expect(
      buildLookupUrl("https://breedops.example", "equipment", VALID_UUID),
    ).toBe(
      `https://breedops.example/app/lookup?type=equipment&id=${VALID_UUID}`,
    );
  });

  it("never encodes a secret, token, or signed URL - only the type and id", () => {
    const url = buildLookupUrl(
      "https://breedops.example",
      "parent",
      VALID_UUID,
    );
    expect(url).not.toMatch(/key|token|secret|signature/i);
  });
});

describe("safe redirect target after login (next param)", () => {
  it("accepts a genuine /app path, preserving its query string", () => {
    expect(safeNextPath("/app/lookup?type=parent&id=" + VALID_UUID)).toBe(
      `/app/lookup?type=parent&id=${VALID_UUID}`,
    );
  });

  it("accepts the exact /app root with no trailing segment", () => {
    expect(safeNextPath("/app")).toBe("/app");
  });

  it("rejects a path that merely starts with the string /app", () => {
    expect(safeNextPath("/application")).toBe("/app");
    expect(safeNextPath("/app-evil")).toBe("/app");
    expect(safeNextPath("/app.evil")).toBe("/app");
  });

  it("falls back to /app for a missing or empty value", () => {
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
  });

  it("rejects an absolute URL (classic open-redirect payload)", () => {
    expect(safeNextPath("https://attacker.example/app")).toBe("/app");
    expect(safeNextPath("http://attacker.example")).toBe("/app");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNextPath("//attacker.example/app")).toBe("/app");
  });

  it("rejects a backslash variant some browsers treat as a slash", () => {
    expect(safeNextPath("/\\attacker.example")).toBe("/app");
  });

  it("rejects a path outside /app", () => {
    expect(safeNextPath("/login")).toBe("/app");
    expect(safeNextPath("/")).toBe("/app");
  });

  it("rejects a non-string value", () => {
    expect(safeNextPath(42)).toBe("/app");
    expect(safeNextPath({})).toBe("/app");
  });
});
