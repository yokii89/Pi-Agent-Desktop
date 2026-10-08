import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import type { SessionSummary } from "../../shared/ipc";
import { getSettings, updateSettings } from "../settings/settings";
import { getPiAgentDir } from "./piInfo";
import { invalidateTranscriptCache } from "./sessionTranscriptRead";

/** 单次最多返回的会话数（"最近"列表不需要全量）。 */
const MAX_SESSIONS = 30;
/** 全量列举的会话数上限（侧边栏按项目分组的总量控制）。 */
const MAX_ALL_SESSIONS = 100;
/** 单文件最多扫描的字节数（找首条用户消息用，避免读入超大文件）。 */
const MAX_SCAN_BYTES = 256 * 1024;

/**
 * pi 的会话目录编码规则：去掉首位路径分隔符后，将 / \ : 替换为 -，
 * 首尾各包一层 --（pi session-manager.ts getDefaultSessionDirPath）。
 */
export function encodeCwdToSessionDir(cwd: string): string {
  const safe = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return `--${safe}--`;
}

interface SessionHeader {
  type: "session";
  id: string;
  timestamp: string;
  /** 会话工作目录；pi v3 起 JSONL 头部携带，旧文件可能缺失。 */
  cwd?: string;
}

interface ParsedUserText {
  header: SessionHeader | null;
  firstUserMessage: string | null;
}

/** 头部解析缓存：mtime/size 未变时跳过 256KB 重读。 */
interface HeadCacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedUserText;
}

const headCache = new Map<string, HeadCacheEntry>();

/** 解析 JSONL：取头部 + 首条用户消息文本（大文件只扫前 MAX_SCAN_BYTES）。 */
async function parseSessionHead(file: string): Promise<ParsedUserText> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    headCache.delete(file);
    return { header: null, firstUserMessage: null };
  }

  const cached = headCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.parsed;
  }

  let text = "";
  try {
    const size = Math.min(stat.size, MAX_SCAN_BYTES);
    const handle = await fsp.open(file, "r");
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      text = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return { header: null, firstUserMessage: null };
  }

  let header: SessionHeader | null = null;
  let firstUserMessage: string | null = null;
  for (const line of text.split("\n")) {
    if (!header && line.trim().length > 0) {
      try {
        const parsed = JSON.parse(line) as Partial<SessionHeader>;
        if (parsed.type === "session" && typeof parsed.id === "string") {
          header = parsed as SessionHeader;
        }
      } catch {
        // 跳过无法解析的行
      }
      continue;
    }
    if (firstUserMessage === null && line.includes('"role":"user"')) {
      try {
        const entry = JSON.parse(line) as {
          message?: { role?: string; content?: unknown };
        };
        if (entry.message?.role === "user") {
          firstUserMessage = extractUserText(entry.message.content);
        }
      } catch {
        // 跳过无法解析的行
      }
    }
    if (header && firstUserMessage !== null) break;
  }

  const parsed: ParsedUserText = { header, firstUserMessage };
  headCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
  return parsed;
}

function extractUserText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

/** toSummaries 解析并发上限（headCache 命中时几乎无 IO）。 */
const SUMMARY_CONCURRENCY = 8;

/**
 * 把已按时间倒序的会话文件解析为摘要列表（cwd 取自 JSONL 头部）。
 * updatedAt 直接取文件 mtime（列表本已按它排序），不再额外 stat。
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
      const { header, firstUserMessage } = await parseSessionHead(file);
      const startedAt = header ? Date.parse(header.timestamp) : mtime;
      summaries[index] = {
        file,
        id: header?.id ?? path.basename(file, ".jsonl"),
        startedAt: Number.isNaN(startedAt) ? 0 : startedAt,
        updatedAt: mtime,
        firstUserMessage,
        cwd: header?.cwd && header.cwd.trim().length > 0 ? header.cwd : null,
      };
    }
  }
  const workers = Array.from({ length: Math.min(SUMMARY_CONCURRENCY, files.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return summaries;
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
 * 列出某项目目录下的 pi 会话历史（按文件修改时间倒序）。
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
 * 列出全部 pi 会话历史（按修改时间倒序，上限 MAX_ALL_SESSIONS）。
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
  if (typeof file !== "string" || !file.toLowerCase().endsWith(".jsonl")) {
    throw new Error("非法的会话文件");
  }
  const root = path.join(getPiAgentDir(), "sessions");
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error("会话文件不在 pi 会话目录内");
  }
  headCache.delete(resolved);
  invalidateTranscriptCache(resolved);
  try {
    await shell.trashItem(resolved);
  } catch {
    throw new Error("移入回收站失败");
  }
  return null;
}
