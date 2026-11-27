/** 目录默认占文件面板的比例；其余空间留给预览。 */
export const FILE_PANEL_DEFAULT_RATIO = 0.4;

const TREE_MIN_WIDTH = 140;
const PREVIEW_MIN_WIDTH = 200;

/** 窄侧栏按比例缩小两侧下限，保留拖拽区间；宽侧栏则保住可读的像素宽度。 */
export function filePanelRatioBounds(availableWidth: number): { min: number; max: number } {
  const width = Math.max(0, availableWidth);
  if (width === 0) return { min: 0.25, max: 0.65 };
  return {
    min: Math.min(TREE_MIN_WIDTH / width, 0.25),
    max: 1 - Math.min(PREVIEW_MIN_WIDTH / width, 0.35),
  };
}

/** 统一指针、键盘与容器缩放后的比例边界，避免任一窗格被挤成零宽。 */
export function clampFilePanelRatio(ratio: number, availableWidth: number): number {
  const { min, max } = filePanelRatioBounds(availableWidth);
  const value = Number.isFinite(ratio) ? ratio : FILE_PANEL_DEFAULT_RATIO;
  return Math.max(min, Math.min(max, value));
}
