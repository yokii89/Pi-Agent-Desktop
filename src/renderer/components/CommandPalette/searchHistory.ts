import type { PaletteScope } from "./types";

export interface PaletteSearchHistoryEntry {
  query: string;
  scope: PaletteScope;
  updatedAt: number;
}

const HISTORY_LIMIT = 20;
const HISTORY_KEY_PREFIX = "pidesk-command-palette-search-history:";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 历史按工作目录键控：换项目后历史不串。 */
function historyKey(workspaceKey: string): string {
  return `${HISTORY_KEY_PREFIX}${workspaceKey || "default"}`;
}

function isEntry(value: unknown): value is PaletteSearchHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PaletteSearchHistoryEntry>;
  return (
    typeof entry.query === "string" &&
    typeof entry.updatedAt === "number" &&
    (entry.scope === "all" ||
      entry.scope === "commands" ||
      entry.scope === "sessions" ||
      entry.scope === "files")
  );
}

export function readPaletteSearchHistory(workspaceKey: string): PaletteSearchHistoryEntry[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(historyKey(workspaceKey)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeHistory(workspaceKey: string, entries: PaletteSearchHistoryEntry[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(historyKey(workspaceKey), JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // 搜索历史只是快捷入口，localStorage 不可用时不应阻断面板主流程
  }
}

/** 记录一次搜索；空查询 / 纯前缀不记，按小写去重后置顶。 */
export function pushPaletteSearchHistory(params: {
  workspaceKey: string;
  query: string;
  scope: PaletteScope;
}): PaletteSearchHistoryEntry[] {
  const query = params.query.trim();
  if (!query || query === ">" || query === "#" || query === "@") {
    return readPaletteSearchHistory(params.workspaceKey);
  }
  const nextEntry: PaletteSearchHistoryEntry = {
    query,
    scope: params.scope,
    updatedAt: Date.now(),
  };
  const dedupeKey = query.toLocaleLowerCase();
  const entries = [
    nextEntry,
    ...readPaletteSearchHistory(params.workspaceKey).filter(
      (entry) => entry.query.toLocaleLowerCase() !== dedupeKey,
    ),
  ].slice(0, HISTORY_LIMIT);
  writeHistory(params.workspaceKey, entries);
  return entries;
}

export function clearPaletteSearchHistory(workspaceKey: string): void {
  writeHistory(workspaceKey, []);
}
