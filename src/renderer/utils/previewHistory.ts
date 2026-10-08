import { normalizePathKey } from "./fileOpen";

/**
 * 文件面板预览的回退/前进历史（纯函数，vitest 覆盖）。
 * 语义对齐浏览器地址栏：新打开截断「前进」分支；同文件重开只原地替换定位行。
 */

/** 历史条目：root 用于项目切换后整体失效，focusLine 供历史导航恢复定位。 */
export interface PreviewHistoryEntry {
  root: string;
  path: string;
  focusLine: number | null;
}

export interface PreviewHistory {
  entries: PreviewHistoryEntry[];
  /** 当前指向的下标；-1 表示空栈。 */
  index: number;
}

export const emptyPreviewHistory: PreviewHistory = { entries: [], index: -1 };

/** 记录一次新的预览打开（push 语义）；同文件（同 root、路径不区分大小写/斜杠）原地替换。 */
export function pushPreviewHistory(
  history: PreviewHistory,
  entry: PreviewHistoryEntry,
): PreviewHistory {
  const current = history.entries[history.index];
  if (
    current &&
    current.root === entry.root &&
    normalizePathKey(current.path) === normalizePathKey(entry.path)
  ) {
    if (current.focusLine === entry.focusLine) return history;
    const entries = history.entries.slice();
    entries[history.index] = { ...current, focusLine: entry.focusLine };
    return { entries, index: history.index };
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry];
  return { entries, index: entries.length - 1 };
}

/** 沿历史前后移动 delta 位：返回目标条目与落位下标；越界 / 空栈返回 null。 */
export function stepPreviewHistory(
  history: PreviewHistory,
  delta: number,
): { entry: PreviewHistoryEntry; index: number } | null {
  const index = history.index + delta;
  const entry = history.entries[index];
  return entry ? { entry, index } : null;
}

/** 是否还能后退（不能时返回键回落为「返回文件树」）。 */
export function canGoBack(history: PreviewHistory): boolean {
  return history.index > 0;
}

/** 是否还能前进。 */
export function canGoForward(history: PreviewHistory): boolean {
  return history.index < history.entries.length - 1;
}
