import type fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { UsageGranularity, UsageQuery, UsageReport } from "../../shared/usage";
import { resolveUsageProject, sanitizePiUsage } from "../../shared/usage";
import { collectSessionFiles } from "../session/sessionHistory";
import {
  type AggregateUsageOptions,
  aggregateUsage,
  type FileUsage,
  type UsageEntry,
} from "./usageAggregate";

/**
 * 用量扫描（IO 层）：枚举 pi 会话 JSONL → 流式提取 assistant 消息 usage 与
 * 会话头部 cwd（项目归属）→ per-file 缓存 → 交给 usageAggregate 纯聚合。
 * 聚合口径见 shared/usage.ts。
 */

/** 单行 JSON 最大长度（防御异常超长行，与会话 transcript 读取同口径）。 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;
/** 文件扫描并发上限（缓存命中时几乎无 IO）。 */
const SCAN_CONCURRENCY = 8;

/** per-file 聚合缓存：mtime/size 未变时跳过整文件重扫。 */
interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  usage: FileUsage;
}

const fileCache = new Map<string, FileCacheEntry>();

/** 磁盘消息时间戳：ISO 字符串或 Unix ms 数字。 */
function toUnixMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 流式扫描单个会话 JSONL，提取 assistant 消息的用量与头部 cwd。 */
async function scanFile(file: string, fallbackTs: number): Promise<FileUsage> {
  const entries: UsageEntry[] = [];
  let cwd: string | null = null;
  const handle = await fsp.open(file, "r");
  const stream = handle.createReadStream({ encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of rl) {
      if (line.length === 0 || line.length > MAX_LINE_BYTES) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed as { type?: unknown; message?: unknown; cwd?: unknown };
      if (record.type === "session") {
        // JSONL 头部携带会话工作目录（pi v3+）；只认首个，后续同名条目忽略
        if (cwd === null && typeof record.cwd === "string" && record.cwd.length > 0) {
          cwd = record.cwd;
        }
        continue;
      }
      if (record.type !== "message") continue;
      if (typeof record.message !== "object" || record.message === null) continue;
      const message = record.message as {
        role?: unknown;
        usage?: unknown;
        provider?: unknown;
        model?: unknown;
        timestamp?: unknown;
      };
      if (message.role !== "assistant") continue;
      const usage = sanitizePiUsage(message.usage);
      if (!usage) continue;
      entries.push({
        ts: toUnixMs(message.timestamp) ?? fallbackTs,
        usage,
        provider: typeof message.provider === "string" ? message.provider : null,
        model: typeof message.model === "string" ? message.model : null,
      });
    }
  } finally {
    rl.close();
    stream.destroy();
    await handle.close();
  }
  return {
    file,
    project: resolveUsageProject(cwd, path.basename(path.dirname(file))),
    entries,
  };
}

/** 扫描（带缓存）单个文件；stat 失败视为已删除，返回 null。 */
async function scanFileCached(file: string): Promise<FileUsage | null> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    fileCache.delete(file);
    return null;
  }
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.usage;
  }
  const usage = await scanFile(file, stat.mtimeMs);
  fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, usage });
  return usage;
}

/**
 * 查询用量报表：枚举全部会话 JSONL → 带缓存扫描 → 纯聚合。
 * 入参逐字段宽松归一：非法值按「全部历史 / 全部项目 / 自动粒度」降级而非报错。
 * since 过滤发生在消息级；文件枚举阶段用 mtime 预筛冷文件（mtime < since 的
 * 文件不可能有 after-since 的消息），边界文件的精度由消息级过滤兜住。
 * project 过滤发生在聚合层（文件级，见 usageAggregate）。
 */
export async function queryUsageReport(raw: unknown): Promise<UsageReport> {
  const query = (typeof raw === "object" && raw !== null ? raw : {}) as UsageQuery;
  const since = normalizeSince(query.since);
  const project =
    typeof query.project === "string" && query.project.length > 0 ? query.project : null;
  const granularity: UsageGranularity | null =
    query.granularity === "day" || query.granularity === "month" ? query.granularity : null;

  const files = await collectSessionFiles(Number.POSITIVE_INFINITY);
  const candidates = since === null ? files : files.filter((f) => f.mtime >= since);

  // 候选集之外的缓存一律清除（已删除/移出的文件不留陈旧聚合）
  const alive = new Set(candidates.map((f) => f.file));
  for (const key of fileCache.keys()) {
    if (!alive.has(key)) fileCache.delete(key);
  }

  const results: (FileUsage | null)[] = new Array(candidates.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const index = next;
      next += 1;
      results[index] = await scanFileCached(candidates[index].file);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, candidates.length) }, () => worker()),
  );

  const fileUsages = results.filter((item): item is FileUsage => item !== null);
  const options: AggregateUsageOptions = { granularity, project };
  return aggregateUsage(fileUsages, since, Date.now(), options);
}

/** since 归一：非法值（含 ≤0 / 非有限数）一律退回「全部历史」。 */
function normalizeSince(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return null;
}
