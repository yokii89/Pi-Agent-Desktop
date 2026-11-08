import { appendFile, mkdir, stat, truncate } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { Logger } from "electron-updater";

/**
 * electron-updater 的日志落盘：其默认 logger 是 console，打包环境 GUI 无控制台，
 * 「差量回退全量」「基准刷新失败」这类链路日志会全部丢失，排障只能对缓存目录做事后取证。
 * console 继续镜像（dev 终端可见），同时追加到 userData/updater.log。
 */

/** 单文件体积上限：诊断日志不追求保留历史，超限清空重来，避免无限增长。 */
const MAX_LOG_BYTES = 1_000_000;

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";
type ConsoleLevel = "info" | "warn" | "error" | "debug";

/** 串行化追加：同一轮询里可能连发多条日志，并发写会交错错行。 */
let writeChain: Promise<void> = Promise.resolve();

/** 本地时区时间戳：更新问题总在和发布时间、缓存文件 mtime 对时，用 UTC 会差一个时区。 */
function localTimestamp(): string {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.` +
    `${pad(now.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function normalizeMessage(message: unknown): string {
  if (message == null) return "";
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.stack ?? message.message;
  return String(message);
}

async function appendLine(level: LogLevel, message: string): Promise<void> {
  const file = path.join(app.getPath("userData"), "updater.log");
  const line = `[${localTimestamp()}] [${level}] ${message}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const { size } = await stat(file);
    if (size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      await truncate(file, 0);
    }
  } catch (err) {
    // 文件尚不存在（ENOENT）属首次写入；其他 stat 异常交给追加步骤自行报错
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  await appendFile(file, line, "utf8");
}

function emit(
  level: LogLevel,
  consoleLevel: ConsoleLevel,
  message: unknown,
  extra?: unknown,
): void {
  let text = normalizeMessage(message);
  if (extra !== undefined) {
    text = text ? `${text} ${normalizeMessage(extra)}` : normalizeMessage(extra);
  }
  console[consoleLevel](text);
  writeChain = writeChain
    .then(() => appendLine(level, text))
    .catch((err) => {
      // 落盘失败只降级：console 镜像已出，不打断更新链路
      console.warn("[updater] 写更新日志失败:", err);
    });
}

/**
 * electron-updater 与 updaterService 自有日志共用的 logger 单例。
 * 在上游 Logger 之上放宽出可选第二参数（console 风格）：错误对象经 normalizeMessage
 * 保留 stack 后并入同一行；对 Logger 仍结构兼容（多出的参数可选），可直接赋给
 * autoUpdater.logger。
 */
export interface UpdaterLogger extends Logger {
  info(message?: unknown, extra?: unknown): void;
  warn(message?: unknown, extra?: unknown): void;
  error(message?: unknown, extra?: unknown): void;
  debug?(message?: string, extra?: unknown): void;
}

export const updaterLogger: UpdaterLogger = {
  info: (message, extra) => emit("INFO", "info", message, extra),
  warn: (message, extra) => emit("WARN", "warn", message, extra),
  error: (message, extra) => emit("ERROR", "error", message, extra),
  debug: (message, extra) => emit("DEBUG", "debug", message, extra),
};
