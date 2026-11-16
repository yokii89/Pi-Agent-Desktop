import {
  OFFICE_MAX_ENTRIES,
  OFFICE_MAX_EXPANDED_BYTES,
  OFFICE_MAX_PAGES,
  type OfficePreviewFormat,
  type OfficePreviewIssue,
} from "../../shared/officePreview";

/** Errors cross the worker boundary as stable codes, never library exception strings. */
export class OfficePreviewError extends Error {
  constructor(readonly issue: OfficePreviewIssue) {
    super(issue);
  }
}

/** Reject oversized ZIP inventories before the rendering libraries inflate their contents. */
export function checkOfficeArchive(data: Uint8Array, format: OfficePreviewFormat): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const compound = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (compound.every((value, index) => data[index] === value)) {
    if (format === "spreadsheet") return;
    throw new OfficePreviewError("encrypted");
  }
  if (data.length < 22 || view.getUint32(0, true) !== 0x04034b50) {
    throw new OfficePreviewError("invalid");
  }
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === data.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new OfficePreviewError("invalid");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (count > OFFICE_MAX_ENTRIES) throw new OfficePreviewError("tooLarge");
  if (view.getUint32(end + 4, true) !== 0 || at + centralSize !== end) {
    throw new OfficePreviewError("invalid");
  }
  let expanded = 0;
  let slides = 0;
  let expectedPart = false;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) {
      throw new OfficePreviewError("invalid");
    }
    if (view.getUint16(at + 8, true) & 1) throw new OfficePreviewError("encrypted");
    expanded += view.getUint32(at + 24, true);
    if (expanded > OFFICE_MAX_EXPANDED_BYTES) throw new OfficePreviewError("tooLarge");
    const nameLength = view.getUint16(at + 28, true);
    const next =
      at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > end) throw new OfficePreviewError("invalid");
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slides++;
    expectedPart ||=
      format === "docx"
        ? name === "word/document.xml"
        : format === "pptx"
          ? name === "ppt/presentation.xml"
          : name === "xl/workbook.xml" || name === "xl/workbook.bin";
    at = next;
  }
  if (slides > OFFICE_MAX_PAGES) throw new OfficePreviewError("tooLarge");
  if (at !== end || !expectedPart) throw new OfficePreviewError("invalid");
}

/** Normalize parser failures without exposing arbitrary document text in UI errors. */
export function officePreviewIssue(error: unknown): OfficePreviewIssue {
  if (error instanceof OfficePreviewError) return error.issue;
  if (error instanceof Error && /password|encrypt/i.test(error.message)) return "encrypted";
  return "failed";
}
