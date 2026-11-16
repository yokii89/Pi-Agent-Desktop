/** Messages are scoped to one mounted preview; id rejects obsolete resize results. */
export interface ImagePreviewRequest {
  id: number;
  url: string;
  mime: string;
  width: number;
}

export type ImagePreviewResponse =
  | { id: number; type: "bitmap"; bitmap: ImageBitmap; width: number; height: number }
  | { id: number; type: "native" }
  | { id: number; type: "error" };

/** Cap both dimensions of the retained preview surface, including on high-DPI displays. */
export function previewBitmapSize(
  width: number,
  height: number,
  targetWidth: number,
): { width: number; height: number } {
  const scale = Math.min(1, Math.max(1, targetWidth) / width, 2048 / width, 2048 / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
