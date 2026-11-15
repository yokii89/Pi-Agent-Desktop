import type { BrowserBoundsRequest } from "../../shared/ipc";

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 主窗口缩放会改变渲染层 CSS px；WebContentsView 的 bounds 仍使用 DIP。 */
export function rendererBoundsToDip(
  bounds: Pick<BrowserBoundsRequest, "x" | "y" | "width" | "height">,
  uiZoomFactor: number,
): BrowserViewBounds {
  const scale = Number.isFinite(uiZoomFactor) && uiZoomFactor > 0 ? uiZoomFactor : 1;
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}
