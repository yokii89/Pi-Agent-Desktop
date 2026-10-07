import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PiShellCandidate, PiShellKind, PiShellProbe, PiShellSource } from "../../shared/ipc";
import { readPiSettingsLenient, readPiSettingsStrict, writePiSettings } from "./piSettings";

/** Git for Windows 的默认安装位置（pi 查找顺序的第二位）。 */
const GIT_BASH_DEFAULT = path.join("C:\\Program Files\\Git", "bin", "bash.exe");

/** where.exe 单次探测的候选上限，避免 PATH 异常长时逐个跑 --version 拖慢探测。 */
const PATH_CANDIDATE_LIMIT = 8;

/** 候选 bash 种类判定：对路径做不区分大小写的包含 / 前缀匹配。 */
function detectKind(candidatePath: string): PiShellKind {
  const lower = candidatePath.toLowerCase();
  if (lower === "c:\\windows\\system32\\bash.exe" || lower.includes("\\windows\\system32\\")) {
    return "wsl";
  }
  if (lower.includes("\\git\\")) return "git-bash";
  if (lower.includes("cygwin")) return "cygwin";
  if (lower.includes("msys")) return "msys2";
  return "unknown";
}

/** 读取 pi settings.json 的 shellPath 原始值；空串 / 非字符串按 null 处理。 */
function readShellPath(): string | null {
  const raw = readPiSettingsLenient().shellPath;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/** `where.exe bash` 列出 PATH 上的全部 bash（保留顺序，上限 8 条）。 */
function locateBashOnPath(): string[] {
  if (process.platform !== "win32") return [];
  try {
    const out = execFileSync("where.exe", ["bash"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, PATH_CANDIDATE_LIMIT);
  } catch {
    return [];
  }
}

/** 运行 `bash --version` 取首行；失败返回 null。 */
function readBashVersion(candidatePath: string): string | null {
  try {
    const out = execFileSync(candidatePath, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return out.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function makeCandidate(
  candidatePath: string,
  source: PiShellSource,
  firstOnPath: boolean,
): PiShellCandidate {
  return {
    path: candidatePath,
    source,
    kind: detectKind(candidatePath),
    version: readBashVersion(candidatePath),
    firstOnPath,
  };
}

/**
 * 启动时探测一次的结果缓存。
 * 设置页每次挂载都全量 `where bash` + `--version` 太重；改为应用启动预热一次，
 * `shellGet` 读缓存；`setPiShellPath` 写入后立即刷新。
 */
let cachedProbe: PiShellProbe | null = null;

/** 读取缓存；未预热时同步探测一次。 */
export function getCachedPiShellProbe(): PiShellProbe {
  if (!cachedProbe) cachedProbe = probePiShell();
  return cachedProbe;
}

/** 启动预热：填充缓存，供后续 shellGet 零成本读取。 */
export function warmPiShellCache(): void {
  cachedProbe = probePiShell();
}

/** 探测 pi 将使用的 bash：候选列表按 pi 查找顺序组装，并推算出 resolved。 */
export function probePiShell(): PiShellProbe {
  const shellPath = readShellPath();

  // 按 pi 查找顺序组装候选；按路径去重（不区分大小写），保留更高优先级来源
  const candidates: PiShellCandidate[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: PiShellCandidate): void => {
    const key = path.normalize(candidate.path).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const settingsCandidate = shellPath ? makeCandidate(shellPath, "settings", false) : null;
  if (settingsCandidate) addCandidate(settingsCandidate);

  const gitDefaultCandidate = fs.existsSync(GIT_BASH_DEFAULT)
    ? makeCandidate(GIT_BASH_DEFAULT, "git-bash-default", false)
    : null;
  if (gitDefaultCandidate) addCandidate(gitDefaultCandidate);

  const pathLines = locateBashOnPath();
  pathLines.forEach((line, index) => {
    addCandidate(makeCandidate(line, "path", index === 0));
  });

  // resolved：shellPath（无论文件是否存在）→ Git 默认位置 → PATH 第一位 → 无
  let resolved: PiShellCandidate | null = null;
  if (shellPath) {
    resolved = candidates.find((c) => c.source === "settings") ?? null;
  } else if (gitDefaultCandidate) {
    resolved = candidates.find((c) => c.source === "git-bash-default") ?? null;
  } else if (pathLines.length > 0) {
    resolved = candidates.find((c) => c.source === "path" && c.firstOnPath) ?? null;
  }

  const warnings: string[] = [];
  // pi 对无效 shellPath 的行为未知，故不静默回退，只提示
  if (shellPath && !fs.existsSync(shellPath)) {
    warnings.push(`shellPath 指向的文件不存在：${shellPath}`);
  }
  const pathFirst = pathLines[0];
  if (pathFirst && detectKind(pathFirst) === "wsl") {
    warnings.push("PATH 中第一位的 bash 是 WSL（System32），pi 可能拿到不符合预期的 bash");
  }

  return { shellPath, candidates, resolved, warnings };
}

/** 校验一个路径能否作为 bash 运行；通过时返回版本首行，否则抛中文错误。 */
export function validateBash(candidatePath: string): string {
  const trimmed = candidatePath.trim();
  if (!trimmed || !fs.existsSync(trimmed)) {
    throw new Error("文件不存在");
  }
  let out: string;
  try {
    out = execFileSync(trimmed, ["--version"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
  } catch {
    throw new Error("无法作为 bash 运行（--version 校验未通过）");
  }
  if (!/bash/i.test(out)) {
    throw new Error("无法作为 bash 运行（--version 校验未通过）");
  }
  return out.trim().split(/\r?\n/)[0] ?? "";
}

/**
 * 写入 / 清除 pi 的 shellPath：读-改-写保留其余字段，只增删改 shellPath。
 * 文件不存在时创建（只含 shellPath）；文件损坏时抛错，绝不覆盖写。
 */
export function setPiShellPath(value: string | null): PiShellProbe {
  if (value !== null) {
    validateBash(value);
  }
  const next = readPiSettingsStrict();
  if (value === null) {
    delete next.shellPath;
  } else {
    next.shellPath = value;
  }
  writePiSettings(next);
  const probe = probePiShell();
  cachedProbe = probe;
  return probe;
}

/**
 * 供底部终端面板使用的轻量 bash 解析：只做「shellPath 文件存在 → Git 默认位置
 * → where.exe 第一位 .exe」，不跑 --version，避免每开一个终端就做全量版本探测。
 */
export function resolveBashForTerminal(): string | null {
  const shellPath = readShellPath();
  if (shellPath && fs.existsSync(shellPath)) return shellPath;
  if (fs.existsSync(GIT_BASH_DEFAULT)) return GIT_BASH_DEFAULT;
  const located = locateBashOnPath().find((p) => /\.exe$/i.test(p) && fs.existsSync(p));
  return located ?? null;
}
