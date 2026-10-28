import { describe, expect, it } from "vitest";
import {
  CsvParseError,
  parseCsv,
  writeCsv,
} from "../src/lib/import-export/csv";
import {
  XlsxParseError,
  parseXlsxWorkbook,
  writeXlsxWorkbook,
} from "../src/lib/import-export/xlsx";
import {
  IMPORT_LIMITS,
  LimitExceededError,
  assertUploadSize,
} from "../src/lib/import-export/limits";
import { entitySpec } from "../src/lib/import-export/entities";
import {
  HeaderError,
  buildRowPayload,
  detectHeaders,
  normalizeField,
  suggestMapping,
} from "../src/lib/import-export/mapping";

describe("parseCsv", () => {
  it("parses a simple comma-separated file", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and newlines", () => {
    expect(parseCsv('a,"b, with comma",c\n"line1\nline2",x,y\n')).toEqual([
      ["a", "b, with comma", "c"],
      ["line1\nline2", "x", "y"],
    ]);
  });

  it("handles escaped double quotes inside a quoted field", () => {
    expect(parseCsv('"she said ""hi""",b\n')).toEqual([['she said "hi"', "b"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF, LF and bare CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4\r5,6")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("treats a fully empty file as zero rows", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("throws CsvParseError on an unterminated quoted field", () => {
    expect(() => parseCsv('a,"unterminated\n')).toThrow(CsvParseError);
  });
});

describe("writeCsv", () => {
  it("quotes only cells that need it and round-trips through parseCsv", () => {
    const rows = [
      ["name", "note"],
      ["simple", 'has "quotes", and, commas'],
      ["with\nnewline", null],
    ];
    const text = writeCsv(rows);
    expect(text).toContain("simple,");
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["simple", 'has "quotes", and, commas'],
      ["with\nnewline", ""],
    ]);
  });
});

describe("detectHeaders", () => {
  it("skips leading blank rows and trims header cells", () => {
    const result = detectHeaders([
      ["", ""],
      [" Parent ID ", " Line Name "],
      ["P-1", "Ligne A"],
    ]);
    expect(result.headers).toEqual(["Parent ID", "Line Name"]);
    expect(result.dataRows).toEqual([["P-1", "Ligne A"]]);
  });

  it("rejects duplicate headers case-insensitively", () => {
    expect(() =>
      detectHeaders([
        ["Parent ID", "parent id"],
        ["x", "y"],
      ]),
    ).toThrow(HeaderError);
  });

  it("rejects a file with no data at all", () => {
    expect(() => detectHeaders([[""], ["", ""]])).toThrow(HeaderError);
  });
});

describe("suggestMapping", () => {
  it("matches headers to field keys ignoring accents, case and punctuation", () => {
    const spec = entitySpec("parent_lines");
    const mapping = suggestMapping(
      ["Parent Code", "Line Name", "Génération"],
      spec.fields,
    );
    expect(mapping.parent_code).toBe(0);
    expect(mapping.line_name).toBe(1);
    expect(mapping.generation).toBe(2);
    expect(mapping.origin).toBeNull();
  });
});

describe("normalizeField", () => {
  const textField = {
    key: "line_name",
    label: "Nom",
    type: "text" as const,
    requiredOnCreate: false,
    immutable: false,
    maxLength: 5,
  };
  const intField = {
    key: "generation",
    label: "Génération",
    type: "integer" as const,
    requiredOnCreate: false,
    immutable: false,
  };
  const numField = {
    key: "total_quantity",
    label: "Quantité",
    type: "numeric" as const,
    requiredOnCreate: false,
    immutable: false,
  };
  const dateField = {
    key: "harvest_date",
    label: "Date",
    type: "date" as const,
    requiredOnCreate: false,
    immutable: false,
  };
  const enumField = {
    key: "priority",
    label: "Priorité",
    type: "enum" as const,
    requiredOnCreate: false,
    immutable: false,
    enumValues: ["low", "medium", "high"] as const,
  };

  it("treats a blank cell as null, not an error", () => {
    expect(normalizeField("   ", intField)).toEqual({ ok: true, value: null });
  });

  it("enforces a text field's max length", () => {
    expect(normalizeField("toolong", textField)).toEqual({
      ok: false,
      error: expect.stringContaining("Nom"),
    });
    expect(normalizeField("ok", textField)).toEqual({ ok: true, value: "ok" });
  });

  it("rejects a non-integer for an integer field", () => {
    expect(normalizeField("3.5", intField)).toMatchObject({ ok: false });
    expect(normalizeField("3", intField)).toEqual({ ok: true, value: 3 });
  });

  it("accepts a decimal for a numeric field", () => {
    expect(normalizeField("12.5", numField)).toEqual({ ok: true, value: 12.5 });
    expect(normalizeField("abc", numField)).toMatchObject({ ok: false });
  });

  it("accepts ISO dates and normalizes d/m/Y to ISO", () => {
    expect(normalizeField("2026-03-01", dateField)).toEqual({
      ok: true,
      value: "2026-03-01",
    });
    expect(normalizeField("01/03/2026", dateField)).toEqual({
      ok: true,
      value: "2026-03-01",
    });
    expect(normalizeField("not a date", dateField)).toMatchObject({
      ok: false,
    });
  });

  it("rejects a value outside an enum's allowed set", () => {
    expect(normalizeField("urgent", enumField)).toMatchObject({ ok: false });
    expect(normalizeField("high", enumField)).toEqual({
      ok: true,
      value: "high",
    });
  });
});

describe("buildRowPayload", () => {
  it("maps a raw row into the RPC's field keys and collects field errors", () => {
    const spec = entitySpec("crosses");
    const mapping = suggestMapping(
      [
        "Cross ID",
        "Parent femelle (Parent ID)",
        "Parent mâle (Parent ID)",
        "Priorité",
      ],
      [
        ...spec.fields,
        ...spec.references.map((r) => ({
          key: r.key,
          label: r.label,
          type: "text" as const,
          requiredOnCreate: r.requiredOnCreate,
          immutable: true,
        })),
      ],
    );
    const { payload, errors } = buildRowPayload(spec, mapping, [
      "X-1",
      "P-1",
      "P-2",
      "urgent",
    ]);
    expect(payload.cross_code).toBe("X-1");
    expect(payload.female_parent_code).toBe("P-1");
    expect(payload.male_parent_code).toBe("P-2");
    expect(errors).toEqual([
      { field: "priority", message: expect.stringContaining("Priorité") },
    ]);
  });

  it("resolves every unmapped field to null rather than guessing a column", () => {
    // null and an absent key are equivalent to the RPC's `row->>'key'` reads,
    // so an explicit null for every field (never a guessed value) is correct.
    const spec = entitySpec("parent_lines");
    const mapping = Object.fromEntries(spec.fields.map((f) => [f.key, null]));
    const { payload, errors } = buildRowPayload(spec, mapping, ["irrelevant"]);
    expect(Object.values(payload).every((value) => value === null)).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe("assertUploadSize", () => {
  it("accepts a file within the limit and rejects one over it", () => {
    expect(() => assertUploadSize(1024)).not.toThrow();
    expect(() => assertUploadSize(IMPORT_LIMITS.maxUploadBytes + 1)).toThrow(
      LimitExceededError,
    );
  });
});

describe("xlsx round-trip", () => {
  it("writes and re-reads a workbook with the same rows", async () => {
    const buffer = await writeXlsxWorkbook([
      {
        name: "Parent Lines",
        headers: ["Parent ID", "Line Name"],
        rows: [
          ["P-1", "Ligne A"],
          ["P-2", "Ligne B"],
        ],
      },
    ]);
    const sheets = await parseXlsxWorkbook(buffer, {
      maxWorksheets: 10,
      maxRows: 100,
      maxColumns: 20,
    });
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Parent Lines");
    expect(sheets[0].rows).toEqual([
      ["Parent ID", "Line Name"],
      ["P-1", "Ligne A"],
      ["P-2", "Ligne B"],
    ]);
  });

  it("rejects a workbook with more worksheets than the limit", async () => {
    const buffer = await writeXlsxWorkbook([
      { name: "A", headers: ["x"], rows: [] },
      { name: "B", headers: ["x"], rows: [] },
    ]);
    await expect(
      parseXlsxWorkbook(buffer, {
        maxWorksheets: 1,
        maxRows: 100,
        maxColumns: 20,
      }),
    ).rejects.toThrow(XlsxParseError);
  });

  it("rejects a workbook with more rows in a sheet than the limit", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [String(i)]);
    const buffer = await writeXlsxWorkbook([
      { name: "Big", headers: ["x"], rows },
    ]);
    await expect(
      parseXlsxWorkbook(buffer, {
        maxWorksheets: 10,
        maxRows: 10,
        maxColumns: 20,
      }),
    ).rejects.toThrow(XlsxParseError);
  });

  it("rejects a file that is not a real xlsx workbook", async () => {
    await expect(
      parseXlsxWorkbook(Buffer.from("not a real xlsx file"), {
        maxWorksheets: 10,
        maxRows: 100,
        maxColumns: 20,
      }),
    ).rejects.toThrow(XlsxParseError);
  });
});
