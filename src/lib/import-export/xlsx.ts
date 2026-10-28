import ExcelJS from "exceljs";

export class XlsxParseError extends Error {}

export type XlsxSheet = {
  name: string;
  /** Raw cell text per row; dates/numbers are stringified, formulas resolved
   * to their last calculated value (never the formula source). */
  rows: string[][];
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // Formula result, rich text, or hyperlink — take the computed/plain text.
    const asFormula = value as {
      result?: unknown;
      text?: string;
      richText?: { text: string }[];
    };
    if (asFormula.richText)
      return asFormula.richText.map((part) => part.text).join("");
    if ("result" in asFormula)
      return cellToString(asFormula.result as ExcelJS.CellValue);
    if (typeof asFormula.text === "string") return asFormula.text;
    return "";
  }
  return String(value);
}

/** Reads every worksheet of an .xlsx file into plain string rows. Caps rows
 * and columns per sheet so a hostile or corrupt workbook cannot exhaust
 * server memory; throws XlsxParseError if a limit is exceeded. */
export async function parseXlsxWorkbook(
  buffer: Buffer,
  limits: { maxWorksheets: number; maxRows: number; maxColumns: number },
): Promise<XlsxSheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new XlsxParseError("Could not read this file as an Excel workbook");
  }
  if (workbook.worksheets.length === 0) {
    throw new XlsxParseError("The workbook has no worksheets");
  }
  if (workbook.worksheets.length > limits.maxWorksheets) {
    throw new XlsxParseError(
      `The workbook has more than ${limits.maxWorksheets} worksheets`,
    );
  }

  return workbook.worksheets.map((sheet) => {
    if (sheet.columnCount > limits.maxColumns) {
      throw new XlsxParseError(
        `Worksheet "${sheet.name}" has more than ${limits.maxColumns} columns`,
      );
    }
    if (sheet.rowCount > limits.maxRows) {
      throw new XlsxParseError(
        `Worksheet "${sheet.name}" has more than ${limits.maxRows} rows`,
      );
    }
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      const columnCount = Math.max(row.cellCount, sheet.columnCount);
      for (let column = 1; column <= columnCount; column += 1) {
        cells.push(cellToString(row.getCell(column).value));
      }
      rows.push(cells);
    });
    // Drop fully-empty trailing rows left by Excel's used-range bookkeeping.
    while (
      rows.length > 0 &&
      rows[rows.length - 1].every((cell) => cell === "")
    ) {
      rows.pop();
    }
    return { name: sheet.name, rows };
  });
}

/** Writes one or more named sheets of string-cell rows (first row = headers)
 * to a real .xlsx workbook buffer. */
export async function writeXlsxWorkbook(
  sheets: {
    name: string;
    headers: string[];
    rows: (string | number | null)[][];
  }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BreedOps";
  workbook.created = new Date();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    worksheet.addRow(sheet.headers);
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
