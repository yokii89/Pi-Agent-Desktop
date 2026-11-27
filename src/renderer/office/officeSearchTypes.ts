import type { OfficePreviewIssue } from "../../shared/officePreview";

export type OfficeSearchScope = "preview" | "file";
export type OfficeSearchLocation =
  | { kind: "page"; page: number; occurrence: number; headingPath: string[] }
  | {
      kind: "cell";
      sheet: number;
      sheetName: string;
      row: number;
      column: number;
      address: string;
    };
export interface OfficeSearchHit {
  id: string;
  snippet: string;
  location: OfficeSearchLocation;
}
export interface OfficeSearchUpdate {
  hits: OfficeSearchHit[];
  processed: number;
  total: number;
  limited: boolean;
}
export interface OfficeSearchProvider {
  kind: "docx" | "pptx" | "spreadsheet";
  previewKey?: string;
  search(
    query: string,
    scope: OfficeSearchScope,
    update: (value: OfficeSearchUpdate) => void,
    signal: AbortSignal,
  ): Promise<void>;
  navigate(hit: OfficeSearchHit, query: string): void;
  clearTarget(): void;
}
export interface OfficeSearchTarget {
  hit: OfficeSearchHit;
  query: string;
  tick: number;
}
export interface OfficePageText {
  text: string;
  headingPath: string[];
  headings: { offset: number; path: string[] }[];
}
export interface SpreadsheetSearchRequest {
  data: Uint8Array;
  query: string;
}
export type SpreadsheetSearchResponse =
  | { type: "progress"; value: OfficeSearchUpdate }
  | { type: "done" }
  | { type: "error"; issue: OfficePreviewIssue };
