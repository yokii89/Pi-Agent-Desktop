import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PiPackageResourceKind, PiPackageSourceKind } from "../../shared/ipc";

/**
 * pi package source 串的解析与安装路径推导（对齐 packages.md）。
 * 不执行任何包代码；只做字符串/路径推算。
 */

export interface ParsedPackageSource {
  kind: PiPackageSourceKind;
  /** 归一后的展示名。 */
  name: string;
  /** npm 包名（含 scope）或 git host/path 或本地路径。 */
  identity: string;
  /** 是否钉死版本/ref（npm@1.2.3、git@v1）。 */
  pinned: boolean;
  /** 原始入参（去掉首尾空白）。 */
  raw: string;
}

const NPM_PREFIX = /^npm:/i;
const GIT_PREFIX = /^git:(?!\/\/)/i;
const PROTOCOL_URL = /^(https?|ssh|git):\/\//i;

/** Mirror pi's local-path normalization before resolving against a settings file. */
function normalizeLocalSourcePath(input: string): string {
  let normalized = input;
  if (
    process.platform === "win32" &&
    normalized.startsWith("/") &&
    !normalized.startsWith("//") &&
    !normalized.includes("\\")
  ) {
    const match = normalized.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (match) {
      const suffix = match[2]?.replaceAll("/", "\\");
      normalized = `${match[1]?.toUpperCase()}:\\${suffix ?? ""}`;
    }
  }
  if (normalized === "~") return os.homedir();
  if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  ) {
    return path.join(os.homedir(), normalized.slice(2));
  }
  if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized);
  return normalized;
}

/** 去掉 `npm:@foo/bar@1.2.3` / `git:host/repo@v1` 的版本段。 */
function stripRef(spec: string): string {
  // scoped npm：@scope/name@version —— 只切最后一个 @ 之后（且不是 scope 前缀）
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash > 0) {
      const rest = spec.slice(slash + 1);
      const at = rest.lastIndexOf("@");
      if (at > 0) return spec.slice(0, slash + 1 + at);
      return spec;
    }
  }
  const at = spec.lastIndexOf("@");
  if (at > 0) return spec.slice(0, at);
  return spec;
}

function hasRef(spec: string): boolean {
  return stripRef(spec) !== spec;
}

/** Resolve Git transport and optional ref without confusing an SSH user with a ref. */
export function gitPackageLocation(input: string): { url: string; ref?: string } {
  let spec = input.replace(GIT_PREFIX, "");
  if (!/^(?:https?|ssh|git):\/\//i.test(spec)) {
    spec = spec.startsWith("git@")
      ? spec.replace(/^git@([^:]+):/, "ssh://git@$1/")
      : `https://${spec}`;
  }
  const pathStart = spec.indexOf("/", spec.indexOf("://") + 3);
  const refAt = spec.lastIndexOf("@");
  const ref = refAt > pathStart && pathStart > 0 ? spec.slice(refAt + 1) : undefined;
  const url = ref === undefined ? spec : spec.slice(0, refAt);
  const parsed = new URL(url);
  if (
    !["https:", "ssh:", "git:"].includes(parsed.protocol) ||
    parsed.password ||
    (parsed.username && parsed.protocol !== "ssh:") ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname ||
    !parsed.pathname.replace(/^\/+|\/+$/g, "") ||
    /(?:^|\/)\.{1,2}(?:\/|$)|%2e|%2f|%5c|[\\\s]/i.test(url.slice(url.indexOf("://") + 3)) ||
    (ref !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/+-]{0,199}$/.test(ref))
  )
    throw new Error("Invalid Git package source or ref.");
  return { url, ...(ref === undefined ? {} : { ref }) };
}

/** Stable host/path identity, restricted to a child of the managed Git directory. */
function gitIdentityToRelPath(url: string): string {
  const parsed = new URL(url);
  const parts = [
    parsed.host.replace(/:/g, "_"),
    ...parsed.pathname
      .replace(/\.git\/?$/i, "")
      .split("/")
      .filter(Boolean),
  ];
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === ".."))
    throw new Error("Invalid Git package path.");
  return parts.join("/");
}

export function parsePackageSource(input: string): ParsedPackageSource {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 32768 || /[\0\r\n]/.test(raw))
    throw new Error("Invalid package source.");

  if (NPM_PREFIX.test(raw)) {
    const spec = raw.replace(NPM_PREFIX, "");
    const name = stripRef(spec);
    const version = spec.slice(name.length);
    if (
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
      (version && !/^@[A-Za-z0-9*^~<>=][A-Za-z0-9.*+_^~<>=| -]{0,159}$/.test(version))
    )
      throw new Error("Invalid npm package name or version.");
    return { kind: "npm", name, identity: name, pinned: hasRef(spec), raw };
  }

  if (GIT_PREFIX.test(raw) || PROTOCOL_URL.test(raw)) {
    const location = gitPackageLocation(raw);
    const identity = gitIdentityToRelPath(location.url);
    return { kind: "git", name: identity, identity, pinned: location.ref !== undefined, raw };
  }

  // Local paths follow pi's expand-tilde, file-URL, and Windows shell-path rules.
  const normalizedLocal = normalizeLocalSourcePath(raw);
  const local = path.isAbsolute(normalizedLocal)
    ? path.normalize(normalizedLocal)
    : normalizedLocal;
  const name = path.basename(local) || local;
  return { kind: "local", name, identity: local, pinned: false, raw };
}

/**
 * 推导安装目录。
 * - npm user → `<agentDir>/npm/<name>`（scoped 为 `npm/@scope/name`）
 * - git user → `<agentDir>/git/<host>/<path>`
 * - project 在对应目录下用 `<cwd>/.pi/{npm,git}`
 * - local 相对路径以所属 settings.json 的目录为基准
 */
export function resolveInstallPath(
  parsed: ParsedPackageSource,
  options: { agentDir: string; local: boolean; cwd: string | null },
): string | null {
  if (parsed.kind === "local" && /\.(?:tgz|tar\.gz)$/i.test(parsed.identity)) {
    const root = options.local
      ? options.cwd
        ? path.join(options.cwd, ".pi")
        : null
      : options.agentDir;
    return root
      ? path.join(
          root,
          "archives",
          createHash("sha256").update(parsed.identity).digest("hex").slice(0, 32),
        )
      : null;
  }
  if (parsed.kind === "local") {
    const sourcePath = parsed.identity;
    if (path.isAbsolute(sourcePath)) return path.normalize(sourcePath);

    const settingsDir = options.local
      ? options.cwd
        ? path.join(options.cwd, ".pi")
        : null
      : options.agentDir;
    return settingsDir ? path.resolve(settingsDir, sourcePath) : null;
  }
  const root = options.local
    ? options.cwd
      ? path.join(options.cwd, ".pi")
      : null
    : options.agentDir;
  if (!root) return null;
  if (parsed.kind === "npm") {
    return path.join(root, "npm", parsed.identity);
  }
  return path.join(root, "git", parsed.identity);
}

/** settings 对象项里的 source 字段提取（字符串项原样返回）。 */
export function sourceFromSettingsItem(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) return item.trim();
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const src = (item as { source?: unknown }).source;
    if (typeof src === "string" && src.trim()) return src.trim();
  }
  return null;
}

/** 对象项是否为「全部资源过滤为空」的停用态。 */
export function isDisabledSettingsItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  const keys = ["extensions", "skills", "prompts", "themes"] as const;
  return keys.every((key) => Array.isArray(record[key]) && (record[key] as unknown[]).length === 0);
}

/** 构造停用用的 settings 对象项（四类资源全空）。 */
export function makeDisabledSettingsItem(source: string): Record<string, unknown> {
  return { source, extensions: [], skills: [], prompts: [], themes: [] };
}

export const RESOURCE_KIND_KEYS: readonly PiPackageResourceKind[] = [
  "extensions",
  "skills",
  "prompts",
  "themes",
];

/** 从 settings 对象项读取某类资源过滤数组；省略 key = 加载全部（返回 null）。 */
export function resourceFilterArray(item: unknown, kind: PiPackageResourceKind): string[] | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const raw = (item as Record<string, unknown>)[kind];
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return raw.filter((x): x is string => typeof x === "string");
}

/**
 * 判断相对包根的资源路径是否被当前过滤启用（对齐 packages.md Package Filtering）。
 * - 省略 key → 全部启用
 * - `[]` → 全部停用
 * - 仅有 `-path` / `!pattern` → 排除命中项
 * - 含正项（`+path` 或裸 path）→ 仅启用命中项
 */
export function isResourceFilterEnabled(filters: string[] | null, relativePath: string): boolean {
  if (filters === null) return true;
  if (filters.length === 0) return false;

  let hasPositive = false;
  let excluded = false;
  let included = false;

  for (const raw of filters) {
    const f = raw.trim();
    if (!f) continue;
    if (f.startsWith("!") || f.startsWith("-")) {
      const p = normalizeFilterPath(f.slice(1));
      if (matchesFilterPath(p, relativePath)) excluded = true;
      continue;
    }
    hasPositive = true;
    const p = normalizeFilterPath(f.startsWith("+") ? f.slice(1) : f);
    if (matchesFilterPath(p, relativePath)) included = true;
  }

  if (excluded) return false;
  return hasPositive ? included : true;
}

function normalizeFilterPath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}

function matchesFilterPath(pattern: string, relativePath: string): boolean {
  if (!pattern) return false;
  if (pattern === relativePath) return true;
  // 支持简单 basename 匹配（`!legacy.ts`）
  if (!pattern.includes("/") && pattern === relativePath.split("/").pop()) return true;
  // 支持 `**/name` 前缀
  if (pattern.startsWith("**/") && pattern.slice(3) === relativePath.split("/").pop()) {
    return true;
  }
  return false;
}

/**
 * 应用单资源启停，返回新的 settings.packages 项。
 * 停用写 `-relativePath`；启用从过滤中移除该路径。无剩余过滤时收成字符串源。
 */
export function applyResourceEnabled(
  item: unknown,
  kind: PiPackageResourceKind,
  relativePath: string,
  enabled: boolean,
): unknown {
  const source = sourceFromSettingsItem(item);
  if (!source) return item;

  const rel = normalizeFilterPath(relativePath);
  const neg = `-${rel}`;
  const pos = `+${rel}`;

  // 包整体停用态：启用单资源 = 仅打开该资源，其余类型保持空数组
  if (isDisabledSettingsItem(item)) {
    if (!enabled) return item;
    const next: Record<string, unknown> = { source };
    for (const key of RESOURCE_KIND_KEYS) {
      next[key] = key === kind ? [pos] : [];
    }
    return next;
  }

  const record: Record<string, unknown> =
    item && typeof item === "object" && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>) }
      : { source };
  record.source = source;

  const existing = resourceFilterArray(item, kind);
  // 省略 key = 全部启用，用「无过滤」表示
  const baseFilters: string[] = existing === null ? [] : [...existing];

  /** 去掉与目标路径相关的条目（正项命中 / 负项命中）。 */
  const withoutTarget = baseFilters.filter((f) => {
    const t = f.trim();
    if (!t) return false;
    if (t.startsWith("!") || t.startsWith("-")) {
      return !matchesFilterPath(normalizeFilterPath(t.slice(1)), rel);
    }
    const p = normalizeFilterPath(t.startsWith("+") ? t.slice(1) : t);
    return !matchesFilterPath(p, rel);
  });

  let filters: string[];
  if (!enabled) {
    filters = [...withoutTarget, neg];
  } else {
    filters = withoutTarget;
  }

  if (filters.length === 0) {
    delete record[kind];
  } else {
    record[kind] = filters;
  }

  const remainingKeys = RESOURCE_KIND_KEYS.filter((k) => k in record);
  if (remainingKeys.length === 0) return source;
  return record;
}
