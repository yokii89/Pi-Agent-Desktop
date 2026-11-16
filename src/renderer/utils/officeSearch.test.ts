import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { OFFICE_SEARCH_MAX_RESULTS } from "../../shared/officePreview";
import { formatOfficeQuote } from "../office/officeQuote";
import {
  officeCellRanges,
  officeMatchOffsets,
  officeSearchSnippet,
  parseOfficePage,
  searchOfficePage,
  searchSheetPreview,
} from "../office/officeSearch";
import type { OfficeSearchUpdate } from "../office/officeSearchTypes";
import type { OfficePageSource } from "../office/renderOfficePages";
import { searchOfficeDocument } from "../office/searchOfficeDocument";
import { sheetPreview } from "../office/spreadsheetData";

function source(texts: string[]): OfficePageSource {
  return {
    length: texts.length,
    getText: async (index) => ({ text: texts[index], headingPath: [], headings: [] }),
    getPage: async () => {
      throw new Error("Search must not render page DOM");
    },
    dispose() {},
  };
}

describe("Office search and source navigation", () => {
  it("matches literal text with stable Unicode offsets and a bounded result count", () => {
    expect(officeMatchOffsets("预算 Budget BUDGET", "budget")).toEqual([3, 10]);
    expect(officeMatchOffsets("a+b aab", "a+b")).toEqual([0]);
    expect(officeMatchOffsets("İstanbul İ", "İ")).toEqual([0, 9]);
    expect(officeMatchOffsets("a".repeat(1000), "a", 3)).toEqual([0, 1, 2]);
    expect(officeSearchSnippet("x".repeat(500), 250, 1).length).toBeLessThan(150);
  });

  it("retains Word heading paths for matches on a reading page", () => {
    const hits = searchOfficePage(
      {
        text: "intro target\nheading\ntarget",
        headingPath: ["第一章"],
        headings: [{ offset: 13, path: ["第一章", "预算"] }],
      },
      4,
      "target",
      10,
    );
    expect(hits[0].location).toEqual({
      kind: "page",
      page: 4,
      occurrence: 0,
      headingPath: ["第一章"],
    });
    expect(hits[1].location).toEqual({
      kind: "page",
      page: 4,
      occurrence: 1,
      headingPath: ["第一章", "预算"],
    });
  });

  it("indexes text across pages without creating page DOM", async () => {
    const updates: OfficeSearchUpdate[] = [];
    await searchOfficeDocument(
      source(["first", "Budget target", "last target"]),
      "target",
      (value) => updates.push(value),
      new AbortController().signal,
    );
    expect(
      updates.at(-1)?.hits.map((hit) => (hit.location.kind === "page" ? hit.location.page : -1)),
    ).toEqual([1, 2]);
    expect(updates.at(-1)).toMatchObject({ processed: 3, total: 3, limited: false });
  });

  it("stops a cancelled scan and preserves already reported results", async () => {
    const controller = new AbortController();
    const updates: OfficeSearchUpdate[] = [];
    await expect(
      searchOfficeDocument(
        source(["target", "target", "target"]),
        "target",
        (value) => {
          updates.push(value);
          controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(updates).toHaveLength(1);
    expect(updates[0].hits).toHaveLength(1);
  });

  it("reports limited searches explicitly", async () => {
    let last: OfficeSearchUpdate | undefined;
    await searchOfficeDocument(
      source(["target ".repeat(OFFICE_SEARCH_MAX_RESULTS + 1), "later"]),
      "target",
      (value) => {
        last = value;
      },
      new AbortController().signal,
    );
    expect(last?.hits).toHaveLength(OFFICE_SEARCH_MAX_RESULTS);
    expect(last?.limited).toBe(true);
  });

  it("finds cells outside the current UI page while preserving sparse coordinates", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      {
        D50000: { t: "s", v: "start" },
        F50100: { t: "s", v: "find needle here" },
        "!ref": "D50000:F50100",
      },
      "预算",
    );
    const preview = sheetPreview(book, 0, XLSX.utils);
    expect(searchSheetPreview(preview, 0, "预算", "needle")[0].location).toEqual({
      kind: "cell",
      sheet: 0,
      sheetName: "预算",
      row: 50099,
      column: 5,
      address: "F50100",
    });
  });

  it("loads a bounded cell window around a full-workbook search result", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      { GY15556: { t: "s", v: "found outside initial preview" }, "!ref": "A1:IP20000" },
      "Sheet",
    );
    const preview = sheetPreview(book, 0, XLSX.utils, { row: 15555, column: 206 });
    expect(preview.range).toBe("GS15501:IP16000");
    expect(preview.rows[55].cells[6]).toBe("found outside initial preview");
    expect(preview.rows.length * preview.columns.length).toBe(25000);
  });

  it("quotes only selected cells instead of including unselected corners", () => {
    expect(
      officeCellRanges([
        { column: "B", row: 1 },
        { column: "C", row: 1 },
        { column: "A", row: 2 },
        { column: "B", row: 2 },
      ]),
    ).toBe("B1:C1, A2:B2");
    expect(
      officeCellRanges([
        { column: "D", row: 50000 },
        { column: "E", row: 50000 },
        { column: "D", row: 50001 },
        { column: "E", row: 50001 },
      ]),
    ).toBe("D50000:E50001");
  });

  it("validates page input and keeps original quote text", () => {
    expect(parseOfficePage(" 18 ", 120)).toBe(17);
    for (const input of ["0", "121", "1.5", "-2", "1e2", "", "NaN"])
      expect(parseOfficePage(input, 120)).toBeNull();
    const original = "金额：12.5\n原文不做改写";
    expect(
      formatOfficeQuote({ kind: "docx", page: 2, headingPath: ["报告", "预算"] }, original),
    ).toContain("报告 › 预算");
    expect(formatOfficeQuote({ kind: "docx", page: 2, headingPath: [] }, original)).toContain(
      "非原文档打印页码",
    );
    expect(
      formatOfficeQuote({ kind: "spreadsheet", sheet: "预算", range: "D50000:F50100" }, original),
    ).toContain("D50000:F50100");
    expect(formatOfficeQuote({ kind: "pptx", page: 18 }, original)).toContain(original);
  });
});
