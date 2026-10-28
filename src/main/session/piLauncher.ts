import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";

export interface PiCommand {
  file: string;
  args: string[];
  /** 实际解析出的 pi 可执行文件路径（展示 / 版本探测用）。 */
  piPath: string;
}

const IS_WINDOWS = process.platform === "win32";

/**
 * Windows 下 pi 通常是 pnpm/npm 的全局 shim（pi.CMD / pi.bat），
 * CreateProcess 不能直接执行批处理，需经 `cmd /d /s /c` 包装；
 * 原生 exe（官方 standalone 发行版）直接 spawn。
 * 参数数组交给 child_process.spawn 按 Windows 规则转义，禁止手动嵌引号。
 */
function wrapCommand(file: string, args: string[]): PiCommand {
  if (!IS_WINDOWS || /\.exe$/i.test(file)) {
    return { file, args, piPath: file };
  }
  return { file: "cmd.exe", args: ["/d", "/s", "/c", file, ...args], piPath: file };
}

/**
 * 只在 PATH 上定位 pi，不跑 `--version`。
 * 供启动时自动配置 `piExecutablePath` 使用；找不到返回 null。
 */
export function detectPiExecutablePath(): string | null {
  if (!IS_WINDOWS) return null;
  return locatePiOnPath();
}

/**
 * `where pi` 查找 PATH 上的 pi。优先级：.exe（standalone 原生二进制）>
 * .cmd/.bat（pnpm/npm 全局 shim，可经 cmd 执行）> 其他。
 * 注意排除无扩展名的 sh shim（pnpm 同时生成，cmd 无法执行）。
 */
function locatePiOnPath(): string | null {
  try {
    const out = execFileSync("where.exe", ["pi"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const lines = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const byExt = (pattern: RegExp): string | undefined => lines.find((line) => pattern.test(line));
    return byExt(/\.exe$/i) ?? byExt(/\.(cmd|bat)$/i) ?? lines[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析 pi 可执行命令：显式配置 > PATH 查找。
 * 找不到或路径不存在时抛错（渲染层展示为"未找到 pi"）。
 */
export function resolvePiCommand(configuredPath: string | null | undefined): PiCommand {
  const candidate = (configuredPath ?? "").trim();
  if (candidate) {
    if (!fs.existsSync(candidate)) {
      throw new Error(`pi 可执行文件不存在：${candidate}`);
    }
    return wrapCommand(candidate, []);
  }
  if (!IS_WINDOWS) {
    return { file: "pi", args: [], piPath: "pi" };
  }
  const located = locatePiOnPath();
  if (!located) {
    throw new Error("未在 PATH 中找到 pi，请到设置中配置 pi 可执行路径");
  }
  return wrapCommand(located, []);
}

/** 版本缓存 TTL；手动校验传 refresh 绕过。pi 原地升级不会改 shim 的 mtime。 */
const PI_VERSION_CACHE_TTL_MS = 30_000;

interface PiVersionCacheEntry {
  key: string;
  version: string;
  at: number;
}

let piVersionCache: PiVersionCacheEntry | null = null;
let piVersionInflight: { key: string; promise: Promise<string | null> } | null = null;

/** 缓存键带文件指纹：换路径 / 换二进制（mtime、size 变化）立即失效。 */
function piVersionCacheKey(command: PiCommand): string {
  try {
    const stat = fs.statSync(command.piPath);
    return `${command.piPath}|${stat.mtimeMs}|${stat.size}`;
  } catch {
    return command.piPath;
  }
}

function execPiVersion(command: PiCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      [...command.args, "--version"],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

/**
 * 异步读取 `pi --version`。Windows 下 pi 多是 .cmd shim，实际经 cmd 再拉一个
 * Node 进程，冷/热都要 1.5s 量级；同步运行会占满主进程事件循环，把同时到达的
 * 其它 IPC（含开屏读取设置）一起压后。因此缓存 30s（键含路径与文件指纹）、
 * 并发只保留一个探测；`refresh` 供设置页手动校验绕过缓存。
 */
export function readPiVersion(
  command: PiCommand,
  options: { refresh?: boolean } = {},
): Promise<string | null> {
  const key = piVersionCacheKey(command);
  if (
    !options.refresh &&
    piVersionCache?.key === key &&
    Date.now() - piVersionCache.at < PI_VERSION_CACHE_TTL_MS
  ) {
    return Promise.resolve(piVersionCache.version);
  }
  if (piVersionInflight?.key === key) return piVersionInflight.promise;

  const promise = execPiVersion(command)
    .then((out) => {
      const version = out.trim().split(/\r?\n/)[0] || null;
      if (version !== null) piVersionCache = { key, version, at: Date.now() };
      return version;
    })
    .catch(() => null)
    .finally(() => {
      if (piVersionInflight?.key === key) piVersionInflight = null;
    });
  piVersionInflight = { key, promise };
  return promise;
}
