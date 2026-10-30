/** RFC 4180-style CSV parsing/writing, hand-rolled rather than a dependency so
 * malformed-input behavior (unbalanced quotes, embedded newlines, duplicate
 * headers) is fully under test, not a library's undocumented edge case. */

export class CsvParseError extends Error {}

/** Parses CSV text into rows of raw string cells. Handles quoted fields
 * (embedded commas, newlines, and escaped "" quotes), CRLF/LF/CR line
 * endings, and a leading UTF-8 BOM. Throws CsvParseError on an unterminated
 * quoted field. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let fieldHadQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldHadQuotes = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field === "" && !fieldHadQuotes) {
      inQuotes = true;
      fieldHadQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvParseError("Unterminated quoted field");
  }
  if (field !== "" || row.length > 0) {
    endRow();
  }
  // Drop a single trailing fully-empty row left by a final newline.
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ""
  ) {
    rows.pop();
  }
  return rows;
}

function needsQuoting(value: string): boolean {
  return /[",\n\r]/.test(value);
}

function quoteCell(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// CSV (unlike XLSX, which types each cell explicitly) has no type metadata:
// spreadsheet applications guess a cell's meaning from its leading
// character, so a free-text field that happens to start with =, +, -, @,
// a tab, or a carriage return is opened by Excel/Sheets/Numbers as a
// formula, not as the text it actually is ("CSV injection" / OWASP
// spreadsheet formula injection). BreedOps exports plenty of user-entered
// free text this way (notes, storage locations, names) that this app does
// not and should not restrict to a safe character set just to make
// exports incidentally safe. Prefixing a lone leading quote neutralizes
// the formula interpretation in every common spreadsheet application
// while leaving the value's own CSV quoting (for commas/newlines) applied
// normally afterward.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/** Writes rows of string cells back to CSV text, quoting only where needed,
 * with a trailing UTF-8 BOM-friendly, CRLF line ending so the result opens
 * correctly in common spreadsheet software. Every cell is first neutralized
 * against spreadsheet formula injection (see neutralizeFormula) before any
 * CSV-syntax quoting is applied. */
export function writeCsv(
  rows: (string | number | null | undefined)[][],
): string {
  return (
    rows
      .map((row) =>
        row
          .map((cell) =>
            quoteCell(
              neutralizeFormula(
                cell === null || cell === undefined ? "" : String(cell),
              ),
            ),
          )
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
