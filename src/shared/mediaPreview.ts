/** 文件面板音视频流专用协议；URL 由主进程签发，不接受渲染层拼接的磁盘路径。 */
export const MEDIA_PREVIEW_SCHEME = "pidesk-av";

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 解析单段 Range：null 表示完整响应，unsatisfiable 表示 416。
 * 只接受安全整数，避免大文件偏移在 Number 精度边界上变成另一段字节。
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (size <= 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "unsatisfiable";
    if (end < start || start >= size) return "unsatisfiable";
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
