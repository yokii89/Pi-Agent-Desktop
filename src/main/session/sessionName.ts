import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { normalizeSessionName } from "./sessionMeta";

/** 从文件末尾回读时每次读取的块大小；普通会话一行远小于它。 */
const TAIL_CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

interface TailInfo {
  endsWithNewline: boolean;
  lastEntryId: string | null;
}

/** 在 `[0, fromInclusive]` 里向前找最后一个换行；找不到返回 -1。 */
async function findPrevNewline(handle: fsp.FileHandle, fromInclusive: number): Promise<number> {
  let end = fromInclusive + 1;
  while (end > 0) {
    const size = Math.min(TAIL_CHUNK_BYTES, end);
    const start = end - size;
    const chunk = Buffer.allocUnsafe(size);
    const { bytesRead } = await handle.read(chunk, 0, size, start);
    const view = bytesRead === size ? chunk : chunk.subarray(0, bytesRead);
    const index = view.lastIndexOf(NEWLINE);
    if (index !== -1) return start + index;
    end = start;
  }
  return -1;
}

/** 读取文件区间 `[start, end)`；一次性分配，超长行也只拷贝一次。 */
async function readRange(handle: fsp.FileHandle, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(end - start);
  let read = 0;
  while (read < buffer.length) {
    const { bytesRead } = await handle.read(buffer, read, buffer.length - read, start + read);
    if (bytesRead <= 0) break;
    read += bytesRead;
  }
  return read === buffer.length ? buffer : buffer.subarray(0, read);
}

/**
 * 读取文件尾部：大小、是否以换行结尾、最后一条带 id 的完整条目。
 * 先倒序定位完整行的边界，再整行读取一次；最后一行可能是写了一半的 JSON，
 * 或本身是几 MB 的图片消息，都不能让回读退化成反复拼接 / 解码。
 */
async function readTailInfo(file: string): Promise<TailInfo> {
  const handle = await fsp.open(file, "r");
  try {
    const stat = await handle.stat();
    let endsWithNewline = true;
    if (stat.size > 0) {
      const lastByte = Buffer.alloc(1);
      await handle.read(lastByte, 0, 1, stat.size - 1);
      endsWithNewline = lastByte[0] === NEWLINE;
    }

    // 最后一条完整条目的内容区间是 [start, contentEnd)；末尾半行整段跳过
    let contentEnd = stat.size;
    if (!endsWithNewline) {
      const lastNewline = await findPrevNewline(handle, stat.size - 1);
      if (lastNewline === -1) {
        return { endsWithNewline, lastEntryId: null };
      }
      contentEnd = lastNewline;
    } else if (stat.size > 0) {
      contentEnd = stat.size - 1;
    }

    while (contentEnd > 0) {
      const newline = await findPrevNewline(handle, contentEnd - 1);
      const start = newline + 1;
      const text = (await readRange(handle, start, contentEnd)).toString("utf8").trim();
      if (text) {
        try {
          const entry = JSON.parse(text) as { id?: unknown };
          if (typeof entry.id === "string" && entry.id.length > 0) {
            return { endsWithNewline, lastEntryId: entry.id };
          }
        } catch {
          // 半行或损坏行：继续往前找
        }
      }
      if (newline < 0) break;
      contentEnd = newline;
    }
    return { endsWithNewline, lastEntryId: null };
  } finally {
    await handle.close();
  }
}

/**
 * 直接追加一条 pi `session_info` 条目（离线重命名 / 清空）。
 *
 * 只在没有本应用存活的 pi 实例时调用：格式与 pi `appendSessionInfo` 一致，
 * `parentId` 取最后一条条目的 id，名字换行压空格并 trim；空名写入 `""`
 * （pi `getSessionName` 把空名视为清除）。
 */
export async function appendSessionName(file: string, rawName: string): Promise<string | null> {
  const name = normalizeSessionName(rawName);
  const tail = await readTailInfo(file);
  if (!tail.endsWithNewline) {
    throw new Error("会话文件正在写入，请稍后重试");
  }
  const entry = {
    type: "session_info",
    id: crypto.randomBytes(4).toString("hex"),
    parentId: tail.lastEntryId,
    timestamp: new Date().toISOString(),
    name: name ?? "",
  };
  await fsp.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  return name;
}
