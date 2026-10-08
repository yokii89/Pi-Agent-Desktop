import { execFileSync } from "node:child_process";
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

/** 运行 `pi --version`（用于设置页校验 / 关于展示）。失败返回 null。 */
export function runPiVersion(command: PiCommand): string | null {
  try {
    const out = execFileSync(command.file, [...command.args, "--version"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    return out.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}
