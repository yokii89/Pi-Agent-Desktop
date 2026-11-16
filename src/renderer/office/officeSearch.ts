import { OFFICE_SEARCH_MAX_RESULTS } from "../../shared/officePreview";
import type { OfficePageText, OfficeSearchHit } from "./officeSearchTypes";
import type { SheetPreview } from "./spreadsheetData";

/** Bounded, case-insensitive literal matching. Offsets always refer to the original text. */
export function officeMatchOffsets(
  text: string,
  query: string,
  limit = OFFICE_SEARCH_MAX_RESULTS,
): number[] {
  if (!query || limit <= 0) return [];
  const lower = text.toLowerCase();
  const needle = lower.length === text.length ? query.toLowerCase() : query;
  const haystack = lower.length === text.length ? lower : text;
  const matches: number[] = [];
  let at = 0;
  while (matches.length < limit) {
    const next = haystack.indexOf(needle, at);
    if (next < 0) break;
    matches.push(next);
    at = next + needle.length;
  }
  return matches;
}

/** Surround each result with enough original text to distinguish repeated headings. */
export function officeSearchSnippet(text: string, at: number, queryLength: number): string {
  const start = Math.max(0, at - 45);
  const end = Math.min(text.length, at + queryLength + 85);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

/** Preserve Word heading context independently of its synthetic reading-page number. */
export function searchOfficePage(
  page: OfficePageText,
  index: number,
  query: string,
  limit: number,
): OfficeSearchHit[] {
  return officeMatchOffsets(page.text, query, limit).map((at, occurrence) => {
    const headingPath =
      page.headings.filter((heading) => heading.offset <= at).at(-1)?.path ??
      page.headingPath.filter(Boolean);
    return {
      id: `page:${index}:${at}`,
      snippet: officeSearchSnippet(page.text, at, query.length),
      location: { kind: "page", page: index, occurrence, headingPath },
    };
  });
}

/** Search all preview rows, including those on another UI page; one result per matching cell. */
export function searchSheetPreview(
  sheet: SheetPreview,
  index: number,
  name: string,
  query: string,
): OfficeSearchHit[] {
  const hits: OfficeSearchHit[] = [];
  for (const row of sheet.rows) {
    for (let column = 0; column < row.cells.length; column++) {
      const text = row.cells[column];
      const at = officeMatchOffsets(text, query, 1)[0];
      if (at === undefined) continue;
      const address = `${sheet.columns[column]}${row.number}`;
      hits.push({
        id: `cell:${index}:${address}`,
        snippet: officeSearchSnippet(text, at, query.length),
        location: {
          kind: "cell",
          sheet: index,
          sheetName: name,
          row: row.number - 1,
          column: officeColumnIndex(sheet.columns[column]),
          address,
        },
      });
      if (hits.length >= OFFICE_SEARCH_MAX_RESULTS) return hits;
    }
  }
  return hits;
}

/** Collapse exactly the selected cells into row ranges, merging adjacent equal spans. */
export function officeCellRanges(cells: readonly { column: string; row: number }[]): string {
  const rows = new Map<number, Set<string>>();
  for (const cell of cells) {
    const columns = rows.get(cell.row) ?? new Set<string>();
    columns.add(cell.column);
    rows.set(cell.row, columns);
  }
  const spans: { first: string; last: string; start: number; end: number }[] = [];
  for (const [row, columns] of [...rows].sort(([a], [b]) => a - b)) {
    const ordered = [...columns].sort((a, b) => officeColumnIndex(a) - officeColumnIndex(b));
    for (let at = 0; at < ordered.length; ) {
      const first = ordered[at];
      let last = first;
      while (
        ++at < ordered.length &&
        officeColumnIndex(ordered[at]) === officeColumnIndex(last) + 1
      )
        last = ordered[at];
      const previous = spans.at(-1);
      if (previous?.first === first && previous.last === last && previous.end === row - 1)
        previous.end = row;
      else spans.push({ first, last, start: row, end: row });
    }
  }
  return spans
    .map(
      (span) =>
        `${span.first}${span.start}${span.first === span.last && span.start === span.end ? "" : `:${span.last}${span.end}`}`,
    )
    .join(", ");
}

/** Convert a validated Excel column label to its zero-based coordinate. */
export function officeColumnIndex(label: string): number {
  let value = 0;
  for (const character of label) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

/** Validate navigation input without silently clamping a typo to another page. */
export function parseOfficePage(value: string, total: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= total ? page - 1 : null;
}
