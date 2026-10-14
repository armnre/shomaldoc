import ExcelJS from "exceljs";

/**
 * M13 — real XLSX export.
 *
 * Produces a genuine Office Open XML workbook (zip container, shared strings,
 * styled header, right-to-left sheet view) rather than a renamed CSV. Persian text
 * is written as text cells so no spreadsheet locale guess can mangle it, and the
 * characters that spreadsheet applications treat as formulas are neutralised the
 * same way the CSV export does.
 */

const DANGEROUS = /^[=+\-@\t\r]/;

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  rtl?: boolean;
}

function safeCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return DANGEROUS.test(value) ? `'${value}` : value;
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "شمال‌داک — دانشگاه شمال، آمل";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), {
      views: [{ rightToLeft: sheet.rtl !== false, state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.headers.map((header) => ({ header, width: Math.max(14, Math.min(46, header.length + 8)) }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    for (const row of sheet.rows) {
      ws.addRow(row.map(safeCell));
    }
    ws.eachRow((row, index) => {
      if (index === 1) return;
      row.alignment = { vertical: "middle", horizontal: "right", readingOrder: "rtl" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Content type + filename helper so the route and the tests agree. */
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
