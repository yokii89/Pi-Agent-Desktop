/**
 * Markdown 预览的引用解析（纯函数，vitest 直接覆盖）。
 * 渲染进程拿不到 node:path，这里自带跨平台（`/` 与 `\`）的拼接与归一。
 */

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Markdown 中的本地引用（图片 src / 链接 href）解析为本地绝对路径。
 * - `http(s):` / `data:` / `mailto:` / 纯锚点 `#` 等非本地引用返回 null。
 * - `file://` 剥协议取 pathname（Windows 盘符会多出前导 `/`，一并去掉）。
 * - 相对路径基于 md 文件所在目录拼接并归一化 `./` `../`；越出根时截断在根。
 */
export function resolveMarkdownRef(src: string, mdPath: string): string | null {
  const raw = src.trim();
  if (!raw || raw.startsWith("#")) return null;

  let value = raw;
  // Windows 盘符绝对路径（D:/ 或 D:\）必须先于协议判断：`D:` 会被协议正则误判为 scheme
  const isDrivePath = /^[a-zA-Z]:[\\/]/.test(value);
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
    // file:///D:/x/y.png → /D:/x/y.png → D:/x/y.png
    if (/^\/[a-zA-Z]:/.test(value)) value = value.slice(1);
  } else if (!isDrivePath && PROTOCOL_RE.test(value)) {
    return null;
  } else {
    try {
      value = decodeURIComponent(value);
    } catch {
      // 含非法百分号转义（如 `100%.png`）时按原文处理
    }
  }

  // 盘符开头（D:/ 或 D:\）或根开头（/ 或 \）按绝对路径归一化
  if (/^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]/.test(value)) {
    return normalizeAbsolute(value);
  }
  return normalizeRelative(dirnameOf(mdPath), value);
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
  return idx > 0 ? p.slice(0, idx) : p;
}

/** 绝对路径归一化：保留盘符 / POSIX 根，`..` 越出根时截断在根。 */
function normalizeAbsolute(value: string): string {
  const winDrive = /^[a-zA-Z]:/.test(value);
  const posixRoot = !winDrive && /^[/\\]/.test(value);
  const sep = value.includes("\\") ? "\\" : "/";
  const floor = winDrive || posixRoot ? 1 : 0;
  const out: string[] = [];
  for (const seg of value.split(/[/\\]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length > floor) out.pop();
      continue;
    }
    out.push(seg);
  }
  return (posixRoot ? "/" : "") + out.join(sep);
}

/** 相对路径拼接归一化：基于 md 所在目录，`..` 不越过根（盘符 / POSIX 根）。 */
function normalizeRelative(baseDir: string, rel: string): string {
  const sep = baseDir.includes("\\") ? "\\" : "/";
  const baseSegs = baseDir.split(/[/\\]+/).filter(Boolean);
  const posixRoot = /^[/\\]/.test(baseDir);
  const floor = /^[a-zA-Z]:$/.test(baseSegs[0] ?? "") || posixRoot ? 1 : 0;
  const out = baseSegs;
  for (const seg of rel.split(/[/\\]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length > floor) out.pop();
      continue;
    }
    out.push(seg);
  }
  return (posixRoot ? "/" : "") + out.join(sep);
}
