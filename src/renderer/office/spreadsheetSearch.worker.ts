import * as XLSX from "xlsx";
import {
  OFFICE_SEARCH_MAX_CELLS,
  OFFICE_SEARCH_MAX_RESULTS,
  OFFICE_SEARCH_MAX_ROWS,
} from "../../shared/officePreview";
import { checkOfficeArchive, officePreviewIssue } from "./officeArchive";
import { officeMatchOffsets, officeSearchSnippet } from "./officeSearch";
import type {
  OfficeSearchHit,
  SpreadsheetSearchRequest,
  SpreadsheetSearchResponse,
} from "./officeSearchTypes";

const respond = (message: SpreadsheetSearchResponse): void => self.postMessage(message);
const options: XLSX.ParsingOptions = {
  type: "array",
  cellHTML: false,
  cellStyles: false,
  bookVBA: false,
};
self.onmessage = ({ data: request }: MessageEvent<SpreadsheetSearchRequest>): void => {
  void (async () => {
    try {
      checkOfficeArchive(request.data, "spreadsheet");
      const names = XLSX.read(request.data, { ...options, bookSheets: true }).SheetNames;
      const hits: OfficeSearchHit[] = [];
      let cells = 0;
      let limited = false;
      respond({
        type: "progress",
        value: { hits: [], processed: 0, total: names.length, limited: false },
      });
      for (let index = 0; index < names.length; index++) {
        let book = XLSX.read(request.data, {
          ...options,
          sheets: index,
          sheetRows: OFFICE_SEARCH_MAX_ROWS,
        });
        let sheet = book.Sheets[names[index]];
        if (sheet?.["!fullref"]) {
          const start = XLSX.utils.decode_range(sheet["!fullref"]).s.r;
          if (start > 0 && start < 1048576) {
            book = XLSX.read(request.data, {
              ...options,
              sheets: index,
              sheetRows: Math.min(1048576, start + OFFICE_SEARCH_MAX_ROWS),
            });
            sheet = book.Sheets[names[index]];
          }
          const full = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
          if (full.e.r - full.s.r + 1 > OFFICE_SEARCH_MAX_ROWS) limited = true;
        }
        const addresses = Object.keys(sheet).filter((address) => /^[A-Z]+\d+$/.test(address));
        for (const address of addresses) {
          cells++;
          if (cells > OFFICE_SEARCH_MAX_CELLS) {
            limited = true;
            break;
          }
          const cell: XLSX.CellObject = sheet[address];
          const text = cell.v === undefined && cell.f ? `=${cell.f}` : XLSX.utils.format_cell(cell);
          const at = officeMatchOffsets(text, request.query, 1)[0];
          if (at !== undefined) {
            const coordinate = XLSX.utils.decode_cell(address);
            hits.push({
              id: `cell:${index}:${address}`,
              snippet: officeSearchSnippet(text, at, request.query.length),
              location: {
                kind: "cell",
                sheet: index,
                sheetName: names[index],
                row: coordinate.r,
                column: coordinate.c,
                address,
              },
            });
            if (hits.length >= OFFICE_SEARCH_MAX_RESULTS) {
              limited = true;
              break;
            }
          }
          if (cells % 2048 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        respond({
          type: "progress",
          value: { hits: [...hits], processed: index + 1, total: names.length, limited },
        });
        if (hits.length >= OFFICE_SEARCH_MAX_RESULTS || cells > OFFICE_SEARCH_MAX_CELLS) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      respond({ type: "done" });
    } catch (error) {
      respond({ type: "error", issue: officePreviewIssue(error) });
    }
  })();
};
