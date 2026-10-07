import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { FsWatchPushMessage } from "../../shared/ipc";
import { FS_IPC } from "../../shared/ipc";
import { getMainWindow } from "../window/createMainWindow";

/**
 * 目录监听（docs/design 30 §2.3）：只监听文件树里「已展开」的目录，
 * 用 Node 内置 fs.watch（非递归）逐目录订阅，150ms 合批后推送受影响目录集合。
 *
 * 关键约束：绝不监听整个 workspace 根递归——否则 node_modules 一装就刷屏卡死主进程。
 * 每个展开的目录只监听其直接子项变动，正好对应文件树「失效该节点缓存并重列」的粒度。
 */

/** 事件合批窗口（ms）：短时间内多次变动合并为一次推送，避免抖动。 */
const WATCH_BATCH_MS = 150;
/** 忽略的目录名：这些目录（内）的变动不触发刷新，规避 .git / node_modules 抖动。 */
const WATCH_IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
/** 单次合批允许携带的最大目录数（防御异常刷屏把 IPC 撑爆）。 */
const MAX_BATCH_DIRS = 200;

interface WatchEntry {
  watcher: fs.FSWatcher;
  /** 引用计数：多个订阅者监听同一目录时共享一个 watcher。 */
  refs: number;
}

/** 绝对路径（path.resolve 归一）→ watcher 条目。 */
const watchers = new Map<string, WatchEntry>();
/** 合批缓冲：受影响目录的绝对路径集合。 */
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function push(): void {
  if (pending.size === 0) return;
  const dirs = [...pending];
  pending = new Set();
  const message: FsWatchPushMessage = { dirs };
  getMainWindow()?.webContents.send(FS_IPC.changed, message);
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    push();
  }, WATCH_BATCH_MS);
}

/** 事件文件名首段命中忽略目录则跳过（如 `node_modules/xxx`、`.git/HEAD`）。 */
function isIgnored(filename: string | null): boolean {
  if (!filename) return false;
  const first = filename.split(/[\\/]/)[0];
  return first !== undefined && WATCH_IGNORE.has(first);
}

function normalizeKey(dir: string): string {
  if (typeof dir !== "string" || dir.length === 0) return "";
  try {
    return path.resolve(dir);
  } catch {
    return "";
  }
}

function closeWatcher(key: string): void {
  const entry = watchers.get(key);
  if (!entry) return;
  watchers.delete(key);
  try {
    entry.watcher.close();
  } catch {
    // 已关闭时忽略
  }
}

/** 订阅一个目录（引用计数 +1）；已在监听时仅增计数。目录不可监听时静默跳过。 */
export function watchDirectory(dir: string): void {
  const key = normalizeKey(dir);
  if (!key) return;
  const existing = watchers.get(key);
  if (existing) {
    existing.refs += 1;
    return;
  }
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(key, { recursive: false }, (_event, filename) => {
      if (isIgnored(typeof filename === "string" ? filename : null)) return;
      if (pending.size >= MAX_BATCH_DIRS && !pending.has(key)) return;
      pending.add(key);
      scheduleFlush();
    });
  } catch {
    // 目录不存在 / 无权限：不阻塞渲染层，跳过监听
    return;
  }
  watcher.on("error", () => {
    closeWatcher(key);
  });
  watchers.set(key, { watcher, refs: 1 });
}

/** 退订一个目录（引用计数 -1）；归零时真正关闭 watcher。 */
export function unwatchDirectory(dir: string): void {
  const key = normalizeKey(dir);
  if (!key) return;
  const entry = watchers.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) closeWatcher(key);
}

/** 应用退出时回收全部 watcher（index.ts will-quit 调用）。 */
export function disposeAllWatchers(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pending = new Set();
  for (const key of [...watchers.keys()]) closeWatcher(key);
}

export function registerWatcherLifecycle(): void {
  app.on("will-quit", () => {
    disposeAllWatchers();
  });
}
