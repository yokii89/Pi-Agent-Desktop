import { OFFICE_SEARCH_MAX_RESULTS, OFFICE_SEARCH_MAX_TEXT } from "../../shared/officePreview";
import { searchOfficePage } from "./officeSearch";
import type { OfficeSearchHit, OfficeSearchUpdate } from "./officeSearchTypes";
import type { OfficePageSource } from "./renderOfficePages";

/** Index text only; yield between pages and keep partial results when the user cancels. */
export async function searchOfficeDocument(
  source: OfficePageSource,
  query: string,
  update: (value: OfficeSearchUpdate) => void,
  signal: AbortSignal,
): Promise<void> {
  const hits: OfficeSearchHit[] = [];
  let characters = 0;
  for (let page = 0; page < source.length; page++) {
    signal.throwIfAborted();
    const text = await source.getText(page, signal);
    characters += text.text.length;
    const limited = characters > OFFICE_SEARCH_MAX_TEXT;
    if (!limited)
      hits.push(...searchOfficePage(text, page, query, OFFICE_SEARCH_MAX_RESULTS - hits.length));
    signal.throwIfAborted();
    const reachedLimit = limited || hits.length >= OFFICE_SEARCH_MAX_RESULTS;
    update({ hits: [...hits], processed: page + 1, total: source.length, limited: reachedLimit });
    if (reachedLimit) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
