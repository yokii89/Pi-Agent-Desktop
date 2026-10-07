import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { PiChatMessage, SessionTranscriptPayload } from "../../shared/ipc";
import { sanitizePiUsage } from "../../shared/usage";
import { getPiAgentDir } from "./piInfo";

/** 单次返回的消息数软上限；超限截断旧消息并打 truncated 标记。 */
const MAX_MESSAGES = 2000;
/** LRU 缓存的会话数上限（进程生命周期内）。 */
const CACHE_LIMIT = 10;
/** 单行 JSON 最大长度（防御异常超长行把 readline 撑爆）。 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

interface TranscriptCacheEntry {
  mtimeMs: number;
  size: number;
  messages: PiChatMessage[];
  startedAt: number | null;
  truncated: boolean;
}

const transcriptCache = new Map<string, TranscriptCacheEntry>();

/** 会话文件被移除时同步失效缓存（由 removeSession 调用）。 */
export function invalidateTranscriptCache(file: string): void {
  transcriptCache.delete(path.resolve(file));
}

function touchCache(key: string, entry: TranscriptCacheEntry): void {
  // Map 迭代序即 LRU：先删再插，保证淘汰最旧
  transcriptCache.delete(key);
  transcriptCache.set(key, entry);
  while (transcriptCache.size > CACHE_LIMIT) {
    const oldest = transcriptCache.keys().next();
    if (oldest.done) break;
    transcriptCache.delete(oldest.value);
  }
}

/** 校验路径必须是 sessions 根内的 .jsonl（与 removeSession 同级安全要求）。 */
function assertSessionFile(file: string): string {
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

interface DiskMessageLine {
  type?: unknown;
  message?: unknown;
}

interface DiskMessageBody {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  timestamp?: unknown;
  usage?: unknown;
  provider?: unknown;
  model?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
}

function isoToUnixMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 磁盘 message 行 → PiChatMessage；结构不对返回 null。 */
function mapDiskMessage(raw: unknown): PiChatMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as DiskMessageBody;
  if (typeof body.role !== "string" || !Array.isArray(body.content)) return null;
  const message: PiChatMessage = {
    role: body.role,
    content: body.content,
  };
  if (typeof body.stopReason === "string") message.stopReason = body.stopReason;
  if (typeof body.errorMessage === "string") message.errorMessage = body.errorMessage;
  // usage 供 run 头徽标与历史会话用量展示；结构不符按缺失处理
  const usage = sanitizePiUsage(body.usage);
  if (usage) message.usage = usage;
  if (typeof body.provider === "string") message.provider = body.provider;
  if (typeof body.model === "string") message.model = body.model;
  if (typeof body.toolCallId === "string") message.toolCallId = body.toolCallId;
  if (typeof body.toolName === "string") message.toolName = body.toolName;
  if (typeof body.isError === "boolean") message.isError = body.isError;
  const ts = isoToUnixMs(body.timestamp);
  // entriesFromMessages 期望 number 时间戳；附在 message 上供其读取
  if (ts !== null) (message as PiChatMessage & { timestamp?: number }).timestamp = ts;
  return message;
}

/**
 * 读取会话 JSONL 转为消息数组（磁盘优先展示，不依赖 pi 进程）。
 * 流式按行读，避免超大会话整文件进内存；mtime/size 未变时走 LRU 缓存。
 */
export async function readSessionTranscript(file: string): Promise<SessionTranscriptPayload> {
  const resolved = assertSessionFile(file);

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw new Error("会话文件不存在");
  }

  const cached = transcriptCache.get(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    touchCache(resolved, cached);
    return {
      messages: cached.messages,
      startedAt: cached.startedAt,
      truncated: cached.truncated,
    };
  }

  const messages: PiChatMessage[] = [];
  let startedAt: number | null = null;
  let truncated = false;

  const stream = await (async () => {
    const handle = await fsp.open(resolved, "r");
    return handle.createReadStream({ encoding: "utf8" });
  })();

  const rl = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      if (line.length > MAX_LINE_BYTES) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed as DiskMessageLine;

      if (startedAt === null && record.type === "session") {
        const header = parsed as { timestamp?: unknown };
        startedAt = isoToUnixMs(header.timestamp);
        continue;
      }
      if (record.type !== "message") continue;
      const message = mapDiskMessage(record.message);
      if (message) messages.push(message);
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (messages.length > MAX_MESSAGES) {
    // 保留最近的消息，保证 IPC 载荷可控
    messages.splice(0, messages.length - MAX_MESSAGES);
    truncated = true;
  }

  const entry: TranscriptCacheEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    messages,
    startedAt,
    truncated,
  };
  touchCache(resolved, entry);
  return { messages, startedAt, truncated };
}
