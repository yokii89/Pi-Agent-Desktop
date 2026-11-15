/**
 * Markdown 预览的引用解析（纯函数，vitest 直接覆盖）。
 * 渲染进程拿不到 node:path，这里自带跨平台（`/` 与 `\`）的拼接与归一。
 */

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Markdown 中的本地引用（图片 src / 链接 href）解析为本地绝对路径。
 * - `http(s):` / `data:` / `mailto:` / 纯锚点 `#` 等非本地引用返回 null。
 * - `file://` 剥协议取 pathname（Windows 盘符会多出前导 `/`，一并去掉）。
 * - 相对路径优先基于 md 文件目录，否则基于显式 baseDir；无目录时返回 null。
 * - 归一化 `./` `../` 时保留盘符、POSIX 根与 UNC 共享目录。
 */
export function resolveMarkdownRef(
  src: string,
  mdPath?: string | null,
  baseDir?: string | null,
): string | null {
  const raw = src.trim();
  if (!raw || raw.startsWith("#")) return null;

  let value = raw;
  // Windows 盘符绝对路径（D:/ 或 D:\）必须先于协议判断：`D:` 会被协议正则误判为 scheme
  const isDrivePath = /^[a-zA-Z]:(?:[\\/]|%5c|%2f)/i.test(value);
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname);
      if (url.hostname) value = `//${url.hostname}${value}`;
    } catch {
      return null;
    }
  } else if (!isDrivePath && PROTOCOL_RE.test(value)) {
    return null;
  } else {
    // URL 片段不属于文件名；文件名里的 # / ? 应由 Markdown URL 编码保留。
    value = value.split(/[?#]/, 1)[0];
    try {
      value = decodeURIComponent(value);
    } catch {
      // 含非法百分号转义（如 `100%.png`）时按原文处理
    }
  }

  // file URL 或 Markdown 生成的 /D:/x/y.png 均指向 Windows 盘符路径。
  if (/^\/[a-zA-Z]:[\\/]/.test(value)) value = value.slice(1);

  // 盘符开头（D:/ 或 D:\）或根开头（/ 或 \）按绝对路径归一化
  if (/^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]/.test(value)) {
    return normalizeAbsolute(value);
  }
  const directory = mdPath ? dirnameOf(mdPath) : baseDir;
  if (!directory || !/^(?:[a-zA-Z]:[\\/]|[/\\])/.test(directory)) return null;
  return normalizeAbsolute(`${directory.replace(/[/\\]+$/, "")}/${value}`);
}

const FENCE_LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  rb: "ruby",
  "c++": "cpp",
  cs: "csharp",
  gql: "graphql",
  ps1: "powershell",
  pwsh: "powershell",
  htm: "html",
  patch: "diff",
};

/**
 * 围栏 info string → shiki 语言 id：取首个空白/元数据分隔符前的 token，
 * 归一常见别名。未知语言原样返回，由高亮侧按「无此文法」降级为纯文本。
 */
export function normalizeFenceLang(info: string): string {
  const token = (info.trim().split(/[\s{:[`]/)[0] ?? "").toLowerCase();
  if (!token) return "plaintext";
  return FENCE_LANG_ALIAS[token] ?? token;
}

/** md 文件所在目录（兼容 / 与 \）。 */
function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx === 0 || (idx === 2 && /^[a-zA-Z]:/.test(p))) return p.slice(0, idx + 1);
  return idx > 0 ? p.slice(0, idx) : p;
}

/** 绝对路径归一化：保留盘符 / POSIX 根，`..` 越出根时截断在根。 */
function normalizeAbsolute(value: string): string {
  const winDrive = /^[a-zA-Z]:/.test(value);
  const unc = /^[/\\]{2}/.test(value);
  const posixRoot = !winDrive && !unc && /^[/\\]/.test(value);
  const sep = value.includes("\\") ? "\\" : "/";
  const floor = unc ? 2 : winDrive ? 1 : 0;
  const out: string[] = [];
  for (const seg of value.split(/[/\\]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length > floor) out.pop();
      continue;
    }
    out.push(seg);
  }
  const prefix = unc ? sep + sep : posixRoot ? "/" : "";
  return prefix + out.join(sep) + (winDrive && out.length === 1 ? sep : "");
}
