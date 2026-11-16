import * as XLSX from "xlsx";
import { OFFICE_MAX_ROWS, OFFICE_PAGE_CACHE_SIZE } from "../../shared/officePreview";
import { checkOfficeArchive, officePreviewIssue } from "./officeArchive";
import {
  type SheetPreview,
  type SpreadsheetRequest,
  type SpreadsheetResponse,
  sheetPreview,
} from "./spreadsheetData";

const options: XLSX.ParsingOptions = {
  type: "array",
  cellHTML: false,
  cellStyles: false,
  bookVBA: false,
};
let bytes: Uint8Array | null = null;
let sheets: string[] = [];
const cache = new Map<string, SheetPreview>();
const respond = (message: SpreadsheetResponse): void => self.postMessage(message);
self.onmessage = (event: MessageEvent<SpreadsheetRequest>): void => {
  const request = event.data;
  try {
    if (request.type === "load") {
      checkOfficeArchive(request.data, "spreadsheet");
      bytes = request.data;
      cache.clear();
      // Sheet names do not require parsing cell values in every worksheet.
      sheets = XLSX.read(bytes, { ...options, bookSheets: true }).SheetNames;
      if (!sheets.length) throw new Error("No sheets");
      respond({ type: "ready", sheets });
    } else if (bytes) {
      const index = request.index;
      if (!Number.isInteger(index) || !sheets[index]) throw new Error("Missing sheet");
      const anchor = request.anchor;
      if (
        anchor &&
        (![anchor.row, anchor.column].every(Number.isSafeInteger) ||
          anchor.row < 0 ||
          anchor.row > 1048575 ||
          anchor.column < 0 ||
          anchor.column > 16383)
      )
        throw new Error("Invalid cell coordinate");
      const key = `${index}:${anchor?.row ?? 0}:${anchor?.column ?? 0}`;
      let preview = cache.get(key);
      if (!preview) {
        const rowLimit = Math.min(1048576, (anchor?.row ?? 0) + OFFICE_MAX_ROWS + 1);
        let book = XLSX.read(bytes, { ...options, sheets: index, sheetRows: rowLimit });
        const sheet = book.Sheets[sheets[index]];
        const fullRef = sheet?.["!fullref"];
        if (fullRef) {
          const start = XLSX.utils.decode_range(fullRef).s.r;
          // sheetRows counts absolute worksheet rows. Offset ranges need their own bounded window.
          if (start > 0 && start <= 1048575)
            book = XLSX.read(bytes, {
              ...options,
              sheets: index,
              sheetRows: Math.min(1048576, Math.max(start, anchor?.row ?? 0) + OFFICE_MAX_ROWS + 1),
            });
        }
        preview = sheetPreview(book, index, XLSX.utils, anchor);
      }
      cache.delete(key);
      cache.set(key, preview);
      while (cache.size > OFFICE_PAGE_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      respond({ type: "sheet", id: request.id, index, sheet: preview });
    }
  } catch (error) {
    respond({
      type: "error",
      issue: officePreviewIssue(error),
      id: request.type === "sheet" ? request.id : undefined,
      index: request.type === "sheet" ? request.index : undefined,
    });
  }
};
