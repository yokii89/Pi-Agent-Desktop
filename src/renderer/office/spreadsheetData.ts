import type { WorkBook } from "xlsx";
import type { OfficePreviewIssue } from "../../shared/officePreview";
import { OFFICE_MAX_COLUMNS, OFFICE_MAX_ROWS } from "../../shared/officePreview";

export interface SheetPreview {
  columns: string[];
  rows: { number: number; cells: string[] }[];
  truncated: boolean;
  totalRows: number;
  totalColumns: number;
  range: string;
}
export type SpreadsheetRequest =
  | { type: "load"; data: Uint8Array }
  | { type: "sheet"; id: number; index: number; anchor?: { row: number; column: number } };
export type SpreadsheetResponse =
  | { type: "ready"; sheets: string[] }
  | { type: "sheet"; id: number; index: number; sheet: SheetPreview }
  | { type: "error"; issue: OfficePreviewIssue; id?: number; index?: number };

/** Plain values only: formulas use saved results, links and rich HTML never become executable markup. */
export function sheetPreview(
  book: WorkBook,
  index: number,
  utils: typeof import("xlsx").utils,
  anchor?: { row: number; column: number },
): SheetPreview {
  const sheet = book.Sheets[book.SheetNames[index]];
  if (!sheet) throw new Error("Missing sheet");
  const ref = sheet["!fullref"] ?? sheet["!ref"];
  if (!ref || (ref === "A1" && sheet.A1?.v === undefined && !sheet.A1?.f))
    return { columns: [], rows: [], truncated: false, totalRows: 0, totalColumns: 0, range: "" };
  const range = utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalColumns = range.e.c - range.s.c + 1;
  if (
    ![range.s.r, range.s.c, totalRows, totalColumns].every(Number.isSafeInteger) ||
    range.s.r < 0 ||
    range.s.c < 0 ||
    totalRows <= 0 ||
    totalColumns <= 0 ||
    range.e.r > 1048575 ||
    range.e.c > 16383
  )
    throw new Error("Invalid sheet range");
  if (anchor) {
    range.s.r +=
      Math.floor(Math.max(0, Math.min(anchor.row, range.e.r) - range.s.r) / OFFICE_MAX_ROWS) *
      OFFICE_MAX_ROWS;
    range.s.c +=
      Math.floor(Math.max(0, Math.min(anchor.column, range.e.c) - range.s.c) / OFFICE_MAX_COLUMNS) *
      OFFICE_MAX_COLUMNS;
  }
  const rowCount = Math.min(range.e.r - range.s.r + 1, OFFICE_MAX_ROWS);
  const colCount = Math.min(range.e.c - range.s.c + 1, OFFICE_MAX_COLUMNS);
  const columns = Array.from({ length: colCount }, (_, col) => utils.encode_col(range.s.c + col));
  const rows = Array.from({ length: rowCount }, (_, row) => ({
    number: range.s.r + row + 1,
    cells: columns.map((_, col) => {
      const cell = sheet[utils.encode_cell({ r: range.s.r + row, c: range.s.c + col })];
      if (!cell) return "";
      return cell.v === undefined && cell.f ? `=${cell.f}` : utils.format_cell(cell);
    }),
  }));
  return {
    columns,
    rows,
    totalRows,
    totalColumns,
    range: utils.encode_range({
      s: range.s,
      e: { r: range.s.r + rowCount - 1, c: range.s.c + colCount - 1 },
    }),
    truncated: rowCount < totalRows || colCount < totalColumns,
  };
}
