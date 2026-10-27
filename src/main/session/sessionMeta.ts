import { createReadStream } from "node:fs";

export interface SessionHeader {
  type: "session";
  id: string;
  timestamp: string;
  /** 会话工作目录；pi v3 起 JSONL 头部携带，旧文件可能缺失。 */
  cwd?: string;
}

export interface SessionNameScan {
  /** 本次扫描区间内是否出现过 session_info（空名也算出现，用于覆盖旧值）。 */
  found: boolean;
  /** 最后一条 session_info 的名字；空串表示显式清除。 */
  value: string | null;
}

export interface SessionScanResult {
  header: SessionHeader | null;
  firstUserMessage: string | null;
  sessionName: SessionNameScan;
  /**
   * 本次扫描区间内最后一条 message 条目的时间（Unix ms）。
   * 只用来表示「会话最近活跃」，改名 / 切模型这类元数据追加不算。
   */
  lastActivityAt: number | null;
  /** 最后一个完整换行之后的绝对字节偏移，下次可从该处增量扫描。 */
  scannedBytes: number;
}

/** 首条用户消息只在前 256KB 内查找（与旧解析口径一致）；会话名不受该上限限制。 */
export const SESSION_HEAD_SCAN_BYTES = 256 * 1024;

/**
 * 行内预筛针：先按字节找特征再解码，图片 / 大工具结果那种几 MB 的行
 * 绝大多数既不解析也不生成字符串。针与 pi 的 JSON.stringify 键序一致。
 */
const SESSION_INFO_NEEDLE = Buffer.from('"type":"session_info"');
const USER_ROLE_NEEDLE = Buffer.from('"role":"user"');
const MESSAGE_PREFIX = Buffer.from('{"type":"message"');
const TIMESTAMP_FIELD = '"timestamp":"';

/** 条目时间戳固定出现在 id / parentId 之后，256 字节足够覆盖前缀。 */
const TIMESTAMP_PREFIX_BYTES = 256;

/** 与 pi `appendSessionInfo` / `getSessionName` 一致：换行压成空格、trim，空串视为未命名。 */
export function normalizeSessionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\r\n]+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

export function extractUserText(content: unknown): string | null {
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

/** 从 message 行前缀取条目时间戳；格式不认识就返回 null（只影响「最近活跃」）。 */
function readEntryTimestamp(line: Buffer): string | null {
  const prefix = (
    line.length > TIMESTAMP_PREFIX_BYTES ? line.subarray(0, TIMESTAMP_PREFIX_BYTES) : line
  ).toString("utf8");
  const start = prefix.indexOf(TIMESTAMP_FIELD);
  if (start === -1) return null;
  const valueStart = start + TIMESTAMP_FIELD.length;
  const end = prefix.indexOf('"', valueStart);
  return end === -1 ? null : prefix.slice(valueStart, end);
}

/**
 * 流式扫描 JSONL 元数据（header / 首条用户消息 / 会话名 / 最后消息时间）。
 *
 * `startOffset > 0` 时只解析追加区间：header 与首条用户消息不重复提取，
 * sessionName 返回该区间内最后一次出现的值（found=false 表示区间内没有新名字）。
 * 只消费到最后一个完整换行为止；写了一半的行留到下次扫描。
 *
 * 逐行迭代按「块 + carry」收集，跨块超长行只在拿到换行时 concat 一次，
 * 避免把逐块增长的 pending 反复拼接（8MB 单行会退化成 O(n²) 拷贝）。
 */
export async function scanSessionFile(file: string, startOffset = 0): Promise<SessionScanResult> {
  const offset = Math.max(0, startOffset);
  let header: SessionHeader | null = null;
  let firstUserMessage: string | null = null;
  let nameFound = false;
  let nameValue: string | null = null;
  let lastMessageTimestamp: string | null = null;
  let scannedBytes = offset;
  let lineStart = offset;
  let sawFirstLine = offset > 0;

  const processLine = (line: Buffer, lineStartAbs: number): void => {
    if (!sawFirstLine) {
      const trimmed = line.toString("utf8").trim();
      if (trimmed) {
        sawFirstLine = true;
        try {
          const parsed = JSON.parse(trimmed) as Partial<SessionHeader> & { type?: unknown };
          if (parsed.type === "session" && typeof parsed.id === "string") {
            header = parsed as SessionHeader;
          }
        } catch {
          // 首行损坏时保持 header=null
        }
      }
    }
    if (
      firstUserMessage === null &&
      offset === 0 &&
      lineStartAbs < SESSION_HEAD_SCAN_BYTES &&
      line.includes(USER_ROLE_NEEDLE)
    ) {
      try {
        const entry = JSON.parse(line.toString("utf8")) as {
          message?: { role?: string; content?: unknown };
        };
        if (entry.message?.role === "user") {
          firstUserMessage = extractUserText(entry.message.content);
        }
      } catch {
        // 跳过无法解析的行
      }
    }
    if (line.includes(SESSION_INFO_NEEDLE)) {
      try {
        const entry = JSON.parse(line.toString("utf8")) as { type?: unknown; name?: unknown };
        if (entry.type === "session_info") {
          nameFound = true;
          nameValue = normalizeSessionName(entry.name);
        }
      } catch {
        // 跳过无法解析的行
      }
    }
    if (
      line.length >= MESSAGE_PREFIX.length &&
      line.subarray(0, MESSAGE_PREFIX.length).equals(MESSAGE_PREFIX)
    ) {
      const timestamp = readEntryTimestamp(line);
      if (timestamp) lastMessageTimestamp = timestamp;
    }
  };

  const stream = createReadStream(file, { start: offset });
  /** 尚未遇到换行的行片段；跨块拼接只发生在整行收齐时。 */
  let carry: Buffer[] = [];
  let carryLength = 0;
  for await (const chunk of stream) {
    const chunkBuffer = chunk as Buffer;
    let pos = 0;
    for (;;) {
      const newlineIndex = chunkBuffer.indexOf(0x0a, pos);
      if (newlineIndex === -1) break;
      const piece = chunkBuffer.subarray(pos, newlineIndex);
      let line = piece;
      if (carryLength > 0) {
        carry.push(piece);
        line = Buffer.concat(carry, carryLength + piece.length);
        carry = [];
        carryLength = 0;
      }
      processLine(line, lineStart);
      lineStart += line.length + 1;
      scannedBytes = lineStart;
      pos = newlineIndex + 1;
    }
    if (pos < chunkBuffer.length) {
      const rest = chunkBuffer.subarray(pos);
      carry.push(rest);
      carryLength += rest.length;
    }
  }

  const parsedActivity = lastMessageTimestamp ? Date.parse(lastMessageTimestamp) : Number.NaN;

  return {
    header,
    firstUserMessage,
    sessionName: { found: nameFound, value: nameValue },
    lastActivityAt: Number.isNaN(parsedActivity) ? null : parsedActivity,
    scannedBytes,
  };
}
