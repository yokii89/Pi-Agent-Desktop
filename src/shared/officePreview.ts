/** Workspace Office preview policy, shared by file IO and renderer loaders. */
export type OfficePreviewFormat = "docx" | "pptx" | "spreadsheet";
export type OfficePreviewIssue = "legacy" | "tooLarge" | "invalid" | "encrypted" | "failed";

export const OFFICE_MAX_BYTES = 20 * 1024 * 1024;
export const OFFICE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const OFFICE_MAX_ENTRIES = 4096;
export const OFFICE_MAX_PAGES = 200;
export const OFFICE_MAX_ROWS = 500;
export const OFFICE_MAX_COLUMNS = 50;
/** Keep layout work bounded without virtualizing selectable table text. */
export const OFFICE_TABLE_PAGE_ROWS = 50;
/** Long unpaginated DOCX documents are split at top-level paragraph/table boundaries. */
export const OFFICE_DOCX_PAGE_ELEMENTS = 250;
export const OFFICE_PAGE_CACHE_SIZE = 3;
export const OFFICE_PARSE_TIMEOUT_MS = 30_000;
export const OFFICE_SEARCH_MAX_RESULTS = 200;
export const OFFICE_SEARCH_MAX_TEXT = 8 * 1024 * 1024;
export const OFFICE_SEARCH_MAX_CELLS = 2_000_000;
export const OFFICE_SEARCH_MAX_ROWS = 100_000;

const FORMATS: Readonly<Record<string, OfficePreviewFormat>> = {
  docx: "docx",
  pptx: "pptx",
  xlsx: "spreadsheet",
  xls: "spreadsheet",
  xlsm: "spreadsheet",
  xlsb: "spreadsheet",
};
const LEGACY = new Set([
  "doc",
  "dot",
  "ppt",
  "pps",
  "pot",
  "wps",
  "wpt",
  "dps",
  "dpt",
  "et",
  "ett",
]);

/** null means a recognized Office format without a built-in reader; undefined means another file type. */
export function officeFormatForPath(path: string): OfficePreviewFormat | null | undefined {
  const name = path.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return Object.hasOwn(FORMATS, ext) ? FORMATS[ext] : LEGACY.has(ext) ? null : undefined;
}
