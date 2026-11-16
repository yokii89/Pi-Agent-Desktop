import { useEffect } from "react";
import { previewHighlights, revealFrameRange } from "../utils/previewDocument";
import { collectMatchRanges } from "../utils/previewFind";

/** Highlights belong to the current page's document and are released as soon as that page changes. */
export function useOfficeSearchHighlight(
  root: HTMLElement | (() => HTMLElement | null) | null,
  query: string,
  occurrence: number,
  identity: unknown,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity explicitly re-applies the selected result after navigation.
  useEffect(() => {
    if (!root || !query) return;
    let registry: ReturnType<typeof previewHighlights>;
    let frame = requestAnimationFrame(() => {
      frame = 0;
      const element = typeof root === "function" ? root() : root;
      if (!element) return;
      registry = previewHighlights(element);
      const ranges = collectMatchRanges(element, query);
      const active = ranges[Math.min(occurrence, ranges.length - 1)];
      if (registry && ranges.length) {
        registry.set("pidesk-office-find", new Highlight(...ranges));
        if (active) registry.set("pidesk-office-find-active", new Highlight(active));
      }
      if (active && !revealFrameRange(active)) {
        // Tables can scroll horizontally inside a vertically scrolling panel. Reveal in both ancestors.
        let host = active.startContainer.parentElement;
        while (host && host !== document.body) {
          const style = getComputedStyle(host);
          const rect = active.getBoundingClientRect();
          const bounds = host.getBoundingClientRect();
          const gap = Number.parseFloat(style.getPropertyValue("--spacing-sm")) || 0;
          if (/(auto|scroll)/.test(style.overflowY) && host.scrollHeight > host.clientHeight) {
            if (rect.top < bounds.top + gap) host.scrollTop += rect.top - bounds.top - gap;
            else if (rect.bottom > bounds.top + host.clientHeight - gap)
              host.scrollTop += rect.bottom - bounds.top - host.clientHeight + gap;
          }
          if (/(auto|scroll)/.test(style.overflowX) && host.scrollWidth > host.clientWidth) {
            if (rect.left < bounds.left + gap) host.scrollLeft += rect.left - bounds.left - gap;
            else if (rect.right > bounds.left + host.clientWidth - gap)
              host.scrollLeft += rect.right - bounds.left - host.clientWidth + gap;
          }
          host = host.parentElement;
        }
      }
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      registry?.delete("pidesk-office-find");
      registry?.delete("pidesk-office-find-active");
    };
  }, [root, query, occurrence, identity]);
}
