import { type RefObject, useEffect } from "react";
import { extensionViewService } from "../services/extensionViewService";

const LAYOUT_DEBOUNCE_MS = 150;

/** Report the active panel or floating content box through the existing View layout event. */
export function useExtensionViewLayout(
  id: string,
  bodyRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !enabled) return;
    let timer: number | undefined;
    let last: { width: number; height: number } | null = null;
    const send = (): void => {
      const width = body.clientWidth;
      const height = body.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (last && last.width === width && last.height === height) return;
      last = { width, height };
      extensionViewService.reportLayout(id, width, height);
    };
    send();
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(send, LAYOUT_DEBOUNCE_MS);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, bodyRef, enabled]);
}
