import type { RefObject } from "react";
import type { TextSelectionSource } from "./textSelection";

export const PREVIEW_CONTENT_EVENT = "pidesk-preview-content";
export const PREVIEW_SELECTION_EVENT = "pidesk-preview-selection";

/** Office pages have their own document so file-provided styles never reach the application. */
export function previewFrame(container: HTMLElement | null): HTMLIFrameElement | null {
  return container?.querySelector<HTMLIFrameElement>("iframe[data-office-preview]") ?? null;
}

/** The current rendered page, or the normal in-page preview for other formats. */
export function previewDocumentRoot(container: HTMLElement | null): HTMLElement | null {
  return previewFrame(container)?.contentDocument?.getElementById("office-content") ?? container;
}

/** A Range must be highlighted in its owning window, even when that document is inside a frame. */
export function previewHighlights(root: HTMLElement | null): typeof CSS.highlights | undefined {
  const view = root?.ownerDocument.defaultView as (Window & Pick<typeof globalThis, "CSS">) | null;
  return view?.CSS?.highlights;
}

/** Reveal a match using host coordinates; the iframe itself can be taller than the sidebar viewport. */
export function revealFrameRange(range: Range): boolean {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!(frame instanceof HTMLElement)) return false;
  const rect = range.getBoundingClientRect();
  const offset = frame.getBoundingClientRect();
  let host = frame.parentElement;
  while (host && host !== document.body) {
    const overflow = getComputedStyle(host).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && host.clientHeight > 0) {
      const bounds = host.getBoundingClientRect();
      const top = offset.top + rect.top;
      const bottom = offset.top + rect.bottom;
      if (top < bounds.top) host.scrollTop += top - bounds.top;
      else if (bottom > bounds.top + host.clientHeight)
        host.scrollTop += bottom - bounds.top - host.clientHeight;
      break;
    }
    host = host.parentElement;
  }
  return true;
}

/** Adapt frame coordinates and selection events to the shared copy/quote toolbar. */
export function frameSelectionSource(
  container: RefObject<HTMLElement | null>,
): TextSelectionSource {
  return {
    read() {
      const frame = previewFrame(container.current);
      const selection = frame?.contentWindow?.getSelection();
      if (!frame || !selection || selection.isCollapsed || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      const root = previewDocumentRoot(container.current);
      if (!root?.contains(range.commonAncestorContainer)) return null;
      const rect = range.getBoundingClientRect();
      const offset = frame.getBoundingClientRect();
      return {
        rect: {
          left: rect.left + offset.left,
          top: rect.top + offset.top,
          bottom: rect.bottom + offset.top,
          width: rect.width,
        },
        getText: () => selection.toString(),
      };
    },
    clear: () => previewFrame(container.current)?.contentWindow?.getSelection()?.removeAllRanges(),
    subscribe(listener) {
      const element = container.current;
      element?.addEventListener(PREVIEW_SELECTION_EVENT, listener);
      return () => element?.removeEventListener(PREVIEW_SELECTION_EVENT, listener);
    },
  };
}
