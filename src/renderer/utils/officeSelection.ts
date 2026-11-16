import type { RefObject } from "react";
import { formatOfficeQuote } from "../office/officeQuote";
import { officeCellRanges } from "../office/officeSearch";
import { frameSelectionSource, previewDocumentRoot, previewFrame } from "./previewDocument";
import type { TextSelectionSource } from "./textSelection";

function wordHeadingPath(root: HTMLElement, range: Range): string[] {
  if (range.startContainer === root || range.startContainer.contains(root)) return [];
  let path: string[] = [];
  try {
    const value: unknown = JSON.parse(root.dataset.officeHeadingPath ?? "[]");
    if (Array.isArray(value)) path = value.map((part) => (typeof part === "string" ? part : ""));
  } catch {
    /* Older/unsupported pages still have a precise original-text citation. */
  }
  for (const heading of root.querySelectorAll<HTMLElement>("[data-office-heading-level]")) {
    if (
      !heading.contains(range.startContainer) &&
      !(heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
      break;
    const level = Number(heading.dataset.officeHeadingLevel);
    if (Number.isInteger(level) && level >= 0 && level < 9) {
      path.length = level;
      path[level] = (heading.textContent ?? "").trim().slice(0, 300);
    }
  }
  return path.filter(Boolean);
}

/** Source-aware selection adapter for both the isolated document and native worksheet tables. */
export function officeSelectionSource(
  container: RefObject<HTMLElement | null>,
): TextSelectionSource {
  const frameSource = frameSelectionSource(container);
  return {
    read() {
      if (previewFrame(container.current)) {
        const snapshot = frameSource.read();
        const selection = previewFrame(container.current)?.contentWindow?.getSelection();
        const page = previewDocumentRoot(container.current)
          ?.firstElementChild as HTMLElement | null;
        if (!snapshot || !selection?.rangeCount || !page) return null;
        const range = selection.getRangeAt(0).cloneRange();
        const number = Number(page.dataset.officePage);
        return {
          ...snapshot,
          getQuoteText: () => {
            const text = snapshot.getText();
            if (!Number.isSafeInteger(number) || number < 1) return text;
            return page.dataset.officeKind === "docx"
              ? formatOfficeQuote(
                  { kind: "docx", page: number, headingPath: wordHeadingPath(page, range) },
                  text,
                )
              : formatOfficeQuote({ kind: "pptx", page: number }, text);
          },
        };
      }
      const selection = window.getSelection();
      const table = container.current?.querySelector<HTMLElement>("table[data-office-sheet]");
      if (!selection || selection.isCollapsed || !selection.rangeCount || !table) return null;
      const range = selection.getRangeAt(0);
      if (!table.contains(range.startContainer) || !table.contains(range.endContainer)) return null;
      return {
        rect: range.getBoundingClientRect(),
        getText: () => selection.toString(),
        getQuoteText: () => {
          const cells = Array.from(
            table.querySelectorAll<HTMLElement>("td[data-office-cell]"),
          ).filter((cell) => range.intersectsNode(cell));
          if (!cells.length) return selection.toString();
          const coordinates = cells.map((cell) => ({
            column: cell.dataset.officeColumn ?? "A",
            row: Number(cell.dataset.officeRow),
          }));
          return formatOfficeQuote(
            {
              kind: "spreadsheet",
              sheet: table.dataset.officeSheet ?? "",
              range: officeCellRanges(coordinates),
            },
            selection.toString(),
          );
        },
      };
    },
    clear() {
      frameSource.clear();
      window.getSelection()?.removeAllRanges();
    },
    subscribe: frameSource.subscribe,
  };
}
