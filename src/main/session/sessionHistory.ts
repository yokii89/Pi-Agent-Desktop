import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import type { SessionSummary } from "../../shared/ipc";
import { getSettings, updateSettings } from "../settings/settings";
import { getPiAgentDir } from "./piInfo";
import { type SessionHeader, scanSessionFile } from "./sessionMeta";
import { invalidateTranscriptCache } from "./sessionTranscriptRead";

/** 单次最多返回的会话数（"最近"列表不需要全量）。 */
const MAX_SESSIONS = 30;
/** 全量列举的会话数上限（侧边栏按项目分组的总量控制）。 */
const MAX_ALL_SESSIONS = 100;

/**
 * pi 的会话目录编码规则：去掉首位路径分隔符后，将 / \ : 替换为 -，
 * 首尾各包一层 --（pi session-manager.ts getDefaultSessionDirPath）。
 */
export function encodeCwdToSessionDir(cwd: string): string {
  const safe = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return `--${safe}--`;
}

interface SessionMeta {
  header: SessionHeader | null;
  firstUserMessage: string | null;
  sessionName: string | null;
  lastActivityAt: number | null;
}

interface MetaCacheEntry extends SessionMeta {
  mtimeMs: number;
  size: number;
  /** 已扫描到的绝对字节偏移（最后一个完整换行之后）。 */
  scannedBytes: number;
}

/** 会话元数据缓存：文件未变直接命中，追加时只读新增字节。 */
const metaCache = new Map<string, MetaCacheEntry>();

const EMPTY_META: SessionMeta = {
  header: null,
  firstUserMessage: null,
  sessionName: null,
  lastActivityAt: null,
};

/**
 * 解析 JSONL 元数据：头部 + 首条用户消息 + 最后一个 session_info 名字。
 *
 * pi 自己的会话列表本来就是整文件读取（session-manager buildSessionInfo），
 * 这里首次遇到文件时也全量扫一次；之后按 mtime/size 缓存，只消费追加区间。
 */
export async function getSessionMeta(file: string): Promise<SessionMeta> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    metaCache.delete(file);
    return EMPTY_META;
  }

  const cached = metaCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  try {
    if (cached && stat.size > cached.size && stat.size >= cached.scannedBytes) {
      const scan = await scanSessionFile(file, cached.scannedBytes);
      const next: MetaCacheEntry = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        header: cached.header,
        firstUserMessage: cached.firstUserMessage,
        sessionName: scan.sessionName.found ? scan.sessionName.value : cached.sessionName,
        lastActivityAt: scan.lastActivityAt ?? cached.lastActivityAt,
        scannedBytes: Math.max(cached.scannedBytes, scan.scannedBytes),
      };
      metaCache.set(file, next);
      return next;
    }

    const scan = await scanSessionFile(file, 0);
    const next: MetaCacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      header: scan.header,
      firstUserMessage: scan.firstUserMessage,
      sessionName: scan.sessionName.found ? scan.sessionName.value : null,
      lastActivityAt: scan.lastActivityAt,
      scannedBytes: scan.scannedBytes,
    };
    metaCache.set(file, next);
    return next;
  } catch {
    // 扫描期间被删除 / 截断：按空元数据处理，下次列表重试
    metaCache.delete(file);
    return EMPTY_META;
  }
}

/** 直接写过会话文件后让元数据缓存失效（下一次列表重读）。转写缓存不受影响。 */
export function invalidateSessionMeta(file: string): void {
  metaCache.delete(path.resolve(file));
}

/**
 * 校验并归一化会话文件路径：只接受 pi 会话目录内的 .jsonl。
 * 渲染层传来的路径不可信，删除 / 重命名共用同一道门。
 */
export function resolveSessionFile(file: unknown): string {
  if (typeof file !== "string" || !file.toLowerCase().endsWith(".jsonl")) {
    throw new Error("非法的会话文件");
  }
  const root = path.join(getPiAgentDir(), "sessions");
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error("会话文件不在 pi 会话目录内");
  }
  return resolved;
}

/** toSummaries 解析并发上限（缓存命中时几乎无 IO）。 */
const SUMMARY_CONCURRENCY = 8;

/**
 * 把会话文件解析为摘要列表（cwd 取自 JSONL 头部）。
 * updatedAt 优先取最后一条消息条目的时间（pi 的 `modified` 同口径），
 * 改名 / 切思考档这类元数据追加不动排序；没有消息时间时回退文件 mtime。
 * 解析走有限并发，避免侧栏刷新在大量冷文件上串行阻塞。
 */
async function toSummaries(files: { file: string; mtime: number }[]): Promise<SessionSummary[]> {
  const summaries: SessionSummary[] = new Array(files.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const index = next;
      next += 1;
      const { file, mtime } = files[index];
      const meta = await getSessionMeta(file);
      const startedAt = meta.header ? Date.parse(meta.header.timestamp) : mtime;
      summaries[index] = {
        file,
        id: meta.header?.id ?? path.basename(file, ".jsonl"),
        startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
        updatedAt: meta.lastActivityAt ?? mtime,
        firstUserMessage: meta.firstUserMessage,
        sessionName: meta.sessionName,
        cwd: meta.header?.cwd && meta.header.cwd.trim().length > 0 ? meta.header.cwd : null,
      };
    }
  }
  const workers = Array.from({ length: Math.min(SUMMARY_CONCURRENCY, files.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 枚举会话根目录下的全部 JSONL 文件（跳过无法读取的目录），按修改时间倒序截断。 */
export async function collectSessionFiles(
  limit: number,
): Promise<{ file: string; mtime: number }[]> {
  const root = path.join(getPiAgentDir(), "sessions");
  let dirs: fs.Dirent[];
  try {
    dirs = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: { file: string; mtime: number }[] = [];
  const dirPaths = dirs.filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  // 目录与目录内文件均并行 stat，避免会话很多时侧栏刷新被串行 IO 拖慢
  await Promise.all(
    dirPaths.map(async (dirPath) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
          const file = path.join(dirPath, entry.name);
          try {
            const stat = await fsp.stat(file);
            files.push({ file, mtime: stat.mtimeMs });
          } catch {
            // 会话文件可能在扫描间隙被删除，跳过
          }
        }),
      );
    }),
  );
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/**
 * 列出某项目目录下的 pi 会话历史（候选按文件 mtime 取最近 30 个，
 * 返回顺序按最后消息时间倒序，改名不改变展示位置）。
 * 目录不存在（该项目从未跑过 pi）时返回空数组。
 */
export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const dir = path.join(getPiAgentDir(), "sessions", encodeCwdToSessionDir(cwd));
  let files: fs.Dirent[];
  try {
    files = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sorted: { file: string; mtime: number }[] = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const file = path.join(dir, entry.name);
    try {
      const stat = await fsp.stat(file);
      sorted.push({ file, mtime: stat.mtimeMs });
    } catch {
      // 扫描间隙删除，跳过
    }
  }
  sorted.sort((a, b) => b.mtime - a.mtime);
  return toSummaries(sorted.slice(0, MAX_SESSIONS));
}

/**
 * 列出全部 pi 会话历史（候选按文件 mtime 取最近 MAX_ALL_SESSIONS 个，
 * 返回顺序按最后消息时间倒序）。
 * 每条带会话自身的工作目录 cwd，渲染层据此把历史归入对应项目或"任务"。
 *
 * 归档会话不参与截断（docs/design/32）：已按 mtime 截掉、但登记在
 * settings.archivedSessions 里的文件显式 stat 补齐——否则会话一多，
 * 归档条目会从归档面板里凭空消失。文件已不存在的登记视为僵尸，顺手清掉。
 */
export async function listAllSessions(): Promise<SessionSummary[]> {
  const summaries = await toSummaries(await collectSessionFiles(MAX_ALL_SESSIONS));
  const archived = getSettings().archivedSessions;
  const files = Object.keys(archived);
  if (files.length === 0) return summaries;

  const known = new Set(summaries.map((session) => session.file));
  const missing: { file: string; mtime: number }[] = [];
  const stale: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      if (known.has(file)) return;
      try {
        const stat = await fsp.stat(file);
        missing.push({ file, mtime: stat.mtimeMs });
      } catch {
        stale.push(file);
      }
    }),
  );
  if (stale.length > 0) {
    const next = { ...archived };
    for (const file of stale) delete next[file];
    updateSettings({ archivedSessions: next });
  }
  if (missing.length === 0) return summaries;
  return [...summaries, ...(await toSummaries(missing))];
}

/**
 * 移除历史会话：把会话 JSONL 文件移入系统回收站（可恢复，非直接删除）。
 * 仅接受 pi 会话目录内的 .jsonl 文件，防止渲染层传入任意路径。
 */
export async function removeSession(file: string): Promise<null> {
  const resolved = resolveSessionFile(file);
  invalidateSessionMeta(resolved);
  invalidateTranscriptCache(resolved);
  try {
    await shell.trashItem(resolved);
  } catch {
    throw new Error("移入回收站失败");
  }
  return null;
}
