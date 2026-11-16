import { OFFICE_PARSE_TIMEOUT_MS } from "../../shared/officePreview";
import type {
  OfficeSearchUpdate,
  SpreadsheetSearchRequest,
  SpreadsheetSearchResponse,
} from "./officeSearchTypes";

/** A full-workbook search has its own worker so cancel never interrupts the visible worksheet. */
export function searchSpreadsheet(
  data: Uint8Array,
  query: string,
  update: (value: OfficeSearchUpdate) => void,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spreadsheetSearch.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    const abort = (): void => finish(new DOMException("Cancelled", "AbortError"));
    const timeout = window.setTimeout(
      () => finish(new Error("Search timed out")),
      OFFICE_PARSE_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("Search failed"));
    worker.onmessage = ({ data: message }: MessageEvent<SpreadsheetSearchResponse>) => {
      if (message.type === "progress") update(message.value);
      else finish(message.type === "error" ? new Error(message.issue) : undefined);
    };
    const copy = data.slice();
    worker.postMessage({ data: copy, query } satisfies SpreadsheetSearchRequest, [copy.buffer]);
  });
}
