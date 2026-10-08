import path from "node:path";
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
const GIT_PREFIX = /^git:/i;
const PROTOCOL_URL = /^(https?|ssh|git):\/\//i;

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

/** 从 git 源提取 host/owner/repo 形态的相对安装路径。 */
function gitIdentityToRelPath(identity: string): string {
  let rest = identity;
  rest = rest.replace(/^(https?|ssh|git):\/\//i, "");
  rest = rest.replace(/^git@/, "");
  // git@github.com:user/repo → github.com/user/repo
  rest = rest.replace(/^([^/:]+):/, "$1/");
  // 去掉末尾 .git
  rest = rest.replace(/\.git$/i, "");
  return rest.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export function parsePackageSource(input: string): ParsedPackageSource {
  const raw = (input ?? "").trim();
  if (!raw) throw new Error("请填写包来源");

  if (NPM_PREFIX.test(raw)) {
    const spec = raw.replace(NPM_PREFIX, "");
    const name = stripRef(spec);
    if (!name) throw new Error("npm 包名无效");
    return { kind: "npm", name, identity: name, pinned: hasRef(spec), raw };
  }

  if (GIT_PREFIX.test(raw)) {
    const spec = raw.replace(GIT_PREFIX, "");
    const withoutRef = stripRef(spec);
    const identity = gitIdentityToRelPath(withoutRef);
    if (!identity) throw new Error("git 来源无效");
    return { kind: "git", name: identity, identity, pinned: hasRef(spec), raw };
  }

  if (PROTOCOL_URL.test(raw)) {
    const withoutRef = stripRef(raw);
    const identity = gitIdentityToRelPath(withoutRef);
    return { kind: "git", name: identity, identity, pinned: hasRef(raw), raw };
  }

  // 本地绝对 / 相对路径
  const local = path.isAbsolute(raw) ? path.normalize(raw) : raw;
  const name = path.basename(local) || local;
  return { kind: "local", name, identity: local, pinned: false, raw };
}

/**
 * 推导安装目录。
 * - npm user → `<agentDir>/npm/<name>`（scoped 为 `npm/@scope/name`）
 * - git user → `<agentDir>/git/<host>/<path>`
 * - project 在对应目录下用 `<cwd>/.pi/{npm,git}`
 * - local → 原路径（normalize 后）
 */
export function resolveInstallPath(
  parsed: ParsedPackageSource,
  options: { agentDir: string; local: boolean; cwd: string | null },
): string | null {
  if (parsed.kind === "local") {
    const p = parsed.identity;
    return path.isAbsolute(p)
      ? path.normalize(p)
      : options.cwd
        ? path.resolve(options.cwd, p)
        : null;
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
