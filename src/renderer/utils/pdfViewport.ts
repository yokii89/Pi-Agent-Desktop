const PDF_TO_CSS_UNITS = 96 / 72;
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_DIMENSION = 16_384;
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export const PDF_MIN_ZOOM = ZOOM_LEVELS[0];
export const PDF_MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

/** Step from a fitted or explicit zoom to the next supported reading size. */
export function stepPdfZoom(zoom: number, direction: -1 | 1): number {
  const levels = direction === 1 ? ZOOM_LEVELS : [...ZOOM_LEVELS].reverse();
  return (
    levels.find((level) => direction * (level - zoom) > 0.000001) ??
    (direction === 1 ? PDF_MAX_ZOOM : PDF_MIN_ZOOM)
  );
}

/** Keep page layout independent of the bounded HiDPI canvas backing store. */
export function getPdfViewportSize(
  page: { width: number; height: number },
  availableWidth: number,
  zoom: number | null,
  pixelRatio: number,
) {
  const scale = zoom === null ? availableWidth / page.width : zoom * PDF_TO_CSS_UNITS;
  const width = page.width * scale;
  const height = page.height * scale;
  const ratio = Math.min(
    pixelRatio,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    MAX_CANVAS_DIMENSION / width,
    MAX_CANVAS_DIMENSION / height,
  );
  return {
    scale,
    zoom: scale / PDF_TO_CSS_UNITS,
    width,
    height,
    canvasWidth: Math.max(1, Math.floor(width * ratio)),
    canvasHeight: Math.max(1, Math.floor(height * ratio)),
  };
}
