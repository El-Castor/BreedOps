import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  exportCrosses,
  exportInventoryLots,
  exportParentLines,
} from "../src/lib/import-export/export";
import { writeCsv } from "../src/lib/import-export/csv";
import {
  parseXlsxWorkbook,
  writeXlsxWorkbook,
} from "../src/lib/import-export/xlsx";

/** A minimal fake of the one supabase-js query shape export.ts actually
 * uses (`.from().select().eq()[...] .order()`), returning canned rows for
 * assertions — not a Supabase integration test (that's covered by the real
 * pgTap/integration suites against a live stack). */
function fakeClient(rows: unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as never;
}

describe("exportParentLines", () => {
  it("produces stable, human-readable headers and no internal/auth columns", async () => {
    const table = await exportParentLines(
      fakeClient([
        {
          parent_code: "P-1",
          line_name: "Ligne A",
          generation: 1,
          origin: null,
          accession: null,
          source: null,
          notes: null,
          status: "active",
          created_at: "2026-01-01",
        },
      ]),
      "prog-1",
    );
    expect(table.headers).toEqual([
      "Parent ID",
      "Nom",
      "Génération",
      "Origine",
      "Accession",
      "Source",
      "Notes",
      "Statut",
      "Créé le",
    ]);
    // "Parent ID" is PROMPT.md's own business-code term, not a secret — check
    // for actual internal/credential terms instead of a bare "id" substring.
    expect(table.headers.join(" ")).not.toMatch(
      /uuid|token|secret|password|service_role/i,
    );
    expect(table.rows).toEqual([
      ["P-1", "Ligne A", 1, null, null, null, null, "active", "2026-01-01"],
    ]);
  });
});

describe("exportCrosses", () => {
  it("resolves embedded parent business codes rather than exposing raw parent UUIDs", async () => {
    const table = await exportCrosses(
      fakeClient([
        {
          cross_code: "X-1",
          female: { parent_code: "P-1" },
          male: { parent_code: "P-2" },
          generation: null,
          target_traits: null,
          pollination_date: null,
          harvest_date: null,
          pollinated_units: null,
          established_units: null,
          total_seeds: null,
          priority: "medium",
          status: "active",
          notes: null,
        },
      ]),
      "prog-1",
    );
    expect(table.rows[0][0]).toBe("X-1");
    expect(table.rows[0][1]).toBe("P-1");
    expect(table.rows[0][2]).toBe("P-2");
    // No column anywhere should carry a raw parent_line_id-shaped UUID string.
    const flattened = table.rows.flat().map(String);
    expect(flattened.some((cell) => /^[0-9a-f-]{36}$/i.test(cell))).toBe(false);
  });
});

describe("exportInventoryLots", () => {
  it("drops a row whose embedded item failed the organization scope filter", async () => {
    const table = await exportInventoryLots(
      fakeClient([
        {
          batch_number: "L-1",
          item: { name: "Agar" },
          received_at: null,
          expiration_date: null,
          current_quantity: 10,
          storage_location: null,
          status: "active",
          notes: null,
        },
        {
          batch_number: "L-2",
          item: null,
          received_at: null,
          expiration_date: null,
          current_quantity: 5,
          storage_location: null,
          status: "active",
          notes: null,
        },
      ]),
      "org-1",
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0]).toBe("Agar");
  });
});

describe("export output format", () => {
  it("writes a CSV that opens correctly (stable headers, quoted special chars)", async () => {
    const table = await exportParentLines(
      fakeClient([
        {
          parent_code: "P-1",
          line_name: 'Has, a "comma"',
          generation: null,
          origin: null,
          accession: null,
          source: null,
          notes: null,
          status: "active",
          created_at: "2026-01-01",
        },
      ]),
      "prog-1",
    );
    const csv = writeCsv([table.headers, ...table.rows]);
    expect(csv.startsWith("Parent ID,Nom,")).toBe(true);
    expect(csv).toContain('"Has, a ""comma"""');
  });

  it("neutralizes CSV formula injection in free-text fields opened by spreadsheet software", () => {
    const csv = writeCsv([
      ["Note"],
      ["=cmd|'/c calc'!A1"],
      ["+1+1"],
      ["-2+3"],
      ["@SUM(A1:A2)"],
      ["\t=HYPERLINK(https://evil.test)"],
      ["Perte de 5% constatée"],
      ["-ras, rien à signaler"],
    ]);
    const rows = csv.trim().split("\r\n").slice(1);
    expect(rows[0]).toBe("'=cmd|'/c calc'!A1");
    expect(rows[1]).toBe("'+1+1");
    expect(rows[2]).toBe("'-2+3");
    expect(rows[3]).toBe("'@SUM(A1:A2)");
    expect(rows[4]).toBe("'\t=HYPERLINK(https://evil.test)");
    // A value that merely contains a dash/plus/at mid-string, rather than
    // leading with one, is never touched - only the spreadsheet-sniffed
    // leading character matters.
    expect(rows[5]).toBe("Perte de 5% constatée");
    // A value containing a comma still gets its ordinary CSV quoting on
    // top of the formula-neutralizing prefix, applied in that order.
    expect(rows[6]).toBe('"\'-ras, rien à signaler"');
  });

  it("writes a real XLSX workbook with the entity's rows on its own sheet", async () => {
    const table = await exportParentLines(
      fakeClient([
        {
          parent_code: "P-1",
          line_name: "Ligne A",
          generation: 2,
          origin: null,
          accession: null,
          source: null,
          notes: null,
          status: "active",
          created_at: "2026-01-01",
        },
      ]),
      "prog-1",
    );
    const buffer = await writeXlsxWorkbook([
      { name: "Lignées parentales", headers: table.headers, rows: table.rows },
    ]);
    const sheets = await parseXlsxWorkbook(buffer, {
      maxWorksheets: 10,
      maxRows: 100,
      maxColumns: 20,
    });
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Lignées parentales");
    expect(sheets[0].rows[0]).toEqual(table.headers);
    expect(sheets[0].rows[1][0]).toBe("P-1");
  });
});
