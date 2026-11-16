import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { OFFICE_MAX_EXPANDED_BYTES, OFFICE_MAX_ROWS } from "../../shared/officePreview";
import { checkOfficeArchive, officePreviewIssue } from "../office/officeArchive";
import { sheetPreview } from "../office/spreadsheetData";

function workbook(): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["名称", "金额"],
    ["项目一", 12.5],
    ["<img src=x onerror=alert(1)>", 25],
  ]);
  sheet.B4 = { t: "n", f: "SUM(B2:B3)", v: 37.5 };
  sheet.B5 = { t: "n", f: "B4*2" };
  sheet["!ref"] = "A1:B5";
  XLSX.utils.book_append_sheet(book, sheet, "预算");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "空表");
  return book;
}
const bytes = (book: XLSX.WorkBook, bookType: "xlsx" | "xls" = "xlsx"): Uint8Array =>
  new Uint8Array(XLSX.write(book, { type: "array", bookType }));

describe("Office parser boundaries", () => {
  it("accepts actual XLSX and BIFF8 workbooks and keeps Chinese text and saved formula values", () => {
    for (const bookType of ["xlsx", "xls"] as const) {
      const data = bytes(workbook(), bookType);
      expect(() => checkOfficeArchive(data, "spreadsheet")).not.toThrow();
      const book = XLSX.read(data, {
        type: "array",
        cellHTML: false,
        sheetRows: OFFICE_MAX_ROWS + 1,
      });
      const preview = sheetPreview(book, 0, XLSX.utils);
      expect(book.SheetNames).toEqual(["预算", "空表"]);
      expect(preview.rows[1].cells).toEqual(["项目一", "12.5"]);
      expect(preview.rows[2].cells[0]).toBe("<img src=x onerror=alert(1)>");
      expect(preview.rows[3].cells[1]).toBe("37.5");
      expect(sheetPreview(book, 1, XLSX.utils).rows).toEqual([]);
    }
  });

  it("shows uncached formulas as text and caps both row and column expansion", () => {
    const book = workbook();
    book.Sheets.预算["!ref"] = "A1:XFD1048576";
    const preview = sheetPreview(book, 0, XLSX.utils);
    expect(preview.rows[4].cells[1]).toBe("=B4*2");
    expect(preview.rows).toHaveLength(500);
    expect(preview.columns).toHaveLength(50);
    expect(preview.totalRows).toBe(1048576);
    expect(preview.truncated).toBe(true);
  });

  it("preserves the actual row and column origin of sparse worksheets", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      { D50000: { t: "s", v: "稀疏内容" }, F50002: { t: "n", v: 123.5 }, "!ref": "D50000:F50002" },
      "稀疏",
    );
    const preview = sheetPreview(book, 0, XLSX.utils);
    expect(preview.columns).toEqual(["D", "E", "F"]);
    expect(preview.rows[0]).toEqual({ number: 50000, cells: ["稀疏内容", "", ""] });
    expect(preview.rows[2].cells[2]).toBe("123.5");
    expect(preview).toMatchObject({
      totalRows: 3,
      totalColumns: 3,
      range: "D50000:F50002",
      truncated: false,
    });
  });

  it("rejects invalid sheet dimensions before allocating rows", () => {
    const book = workbook();
    book.Sheets.预算["!ref"] = "A1:XFD999999999";
    expect(() => sheetPreview(book, 0, XLSX.utils)).toThrow("Invalid sheet range");
  });

  it("rejects mislabeled, truncated and empty archives without treating them as source text", () => {
    const data = bytes(workbook());
    expect(() => checkOfficeArchive(data, "docx")).toThrow("invalid");
    expect(() => checkOfficeArchive(data.subarray(0, data.length - 1), "spreadsheet")).toThrow(
      "invalid",
    );
    expect(() => checkOfficeArchive(new Uint8Array(), "pptx")).toThrow("invalid");
    expect(() =>
      checkOfficeArchive(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "docx"),
    ).toThrow("encrypted");
  });

  it("rejects excessive declared expansion before decompression", () => {
    const data = bytes(workbook());
    const view = new DataView(data.buffer);
    const end = data.length - 22;
    const directory = view.getUint32(end + 16, true);
    view.setUint32(directory + 24, OFFICE_MAX_EXPANDED_BYTES + 1, true);
    expect(() => checkOfficeArchive(data, "spreadsheet")).toThrow("tooLarge");
  });

  it("returns stable failure categories instead of parser or document strings", () => {
    expect(officePreviewIssue(new Error("File is password-protected"))).toBe("encrypted");
    expect(officePreviewIssue(new Error("arbitrary contents"))).toBe("failed");
  });
});
