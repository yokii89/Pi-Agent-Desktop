export interface FloatingWindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingWindowSize {
  width: number;
  height: number;
}

/** Session-local geometry; the owner controls its lifetime. */
export interface FloatingWindowMemory {
  rect?: FloatingWindowRect;
}

const VIEWPORT_MARGIN = 12;

/** Keep the whole tool window reachable, including when the viewport is smaller than its minimum. */
export function fitFloatingWindow(
  rect: FloatingWindowRect,
  viewport: FloatingWindowSize,
  minimum: FloatingWindowSize,
): FloatingWindowRect {
  const marginX = Math.min(VIEWPORT_MARGIN, Math.max(0, (viewport.width - 1) / 2));
  const marginY = Math.min(VIEWPORT_MARGIN, Math.max(0, (viewport.height - 1) / 2));
  const maxWidth = Math.max(1, viewport.width - marginX * 2);
  const maxHeight = Math.max(1, viewport.height - marginY * 2);
  const width = Math.min(Math.max(rect.width, minimum.width), maxWidth);
  const height = Math.min(Math.max(rect.height, minimum.height), maxHeight);
  return {
    left: Math.min(Math.max(rect.left, marginX), viewport.width - width - marginX),
    top: Math.min(Math.max(rect.top, marginY), viewport.height - height - marginY),
    width,
    height,
  };
}
