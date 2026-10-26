/**
 * pi 本地资源目录的扫描与逐项启停（对齐 pi package-manager 的自动发现口径）。
 *
 * 自动发现目录里的资源默认全部启用；pi 用 settings.<kind> 数组里的
 * `-相对路径` / `+相对路径` 精确覆盖，`!glob` 做排除。这里读同一套状态，
 * 写盘也只追加 `+` / `-` 精确项，不动用户手写的普通路径与 `!` 规则。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  PiLocalResourceDir,
  PiLocalResourceItem,
  PiLocalResourceKind,
  PiLocalResourceSetEnabledRequest,
} from "../../shared/ipc";

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

interface LocalResourceLocation {
  dir: string;
  /** pi 计算 settings 模式时的基准目录（metadata.baseDir）。 */
  baseDir: string;
  resourceType: ResourceType;
  /** `pi` 模式会额外把根级 .md 当作独立技能；`.agents` 模式忽略根级 .md。 */
  skillMode?: "pi" | "agents";
}

function locationFor(
  kind: PiLocalResourceKind,
  agentDir: string,
  homeDir: string,
): LocalResourceLocation {
  if (kind === "sharedSkills") {
    const baseDir = path.join(homeDir, ".agents");
    return {
      dir: path.join(baseDir, "skills"),
      baseDir,
      resourceType: "skills",
      skillMode: "agents",
    };
  }
  if (kind === "skills") {
    return {
      dir: path.join(agentDir, "skills"),
      baseDir: agentDir,
      resourceType: "skills",
      skillMode: "pi",
    };
  }
  return { dir: path.join(agentDir, kind), baseDir: agentDir, resourceType: kind };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function normalizePattern(p: string): string {
  return toPosix(p.trim()).replace(/^\.\//, "");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isFileLike(dir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
}

function isDirLike(fullPath: string): boolean {
  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function plainEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 文件判定优先用 dirent，只有符号链接才额外 stat。 */
function isFileEntry(entry: fs.Dirent, dir: string): boolean {
  return entry.isFile() || (entry.isSymbolicLink() && isFileLike(dir, entry.name));
}

function scanSkills(dir: string, mode: "pi" | "agents"): string[] {
  const out: string[] = [];
  const walk = (current: string, isRoot: boolean): void => {
    const entries = plainEntries(current);
    const skill = entries.find((entry) => entry.name === "SKILL.md");
    if (skill && isFileEntry(skill, current)) {
      out.push(path.join(current, "SKILL.md"));
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      const fileLike = isFileEntry(entry, current);
      if (isRoot && mode === "pi" && fileLike && entry.name.endsWith(".md")) {
        out.push(full);
        continue;
      }
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirLike(full))) {
        walk(full, false);
      }
    }
  };
  walk(dir, true);
  return out;
}

/** 复用父级 readdir 结果判断锚点文件，避免逐目录 existsSync。 */
function resolveExtensionEntries(dir: string, entries: readonly fs.Dirent[]): string[] | null {
  const names = new Set(entries.map((entry) => entry.name));
  if (names.has("package.json")) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8").replace(/^﻿/, "")) as unknown;
      const pi =
        parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).pi : undefined;
      const list =
        pi && typeof pi === "object" ? (pi as Record<string, unknown>).extensions : undefined;
      if (Array.isArray(list)) {
        const resolved = list
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => path.resolve(dir, item))
          .filter((item) => fs.existsSync(item));
        if (resolved.length > 0) return resolved;
      }
    } catch {
      // package.json 损坏时退回 index 约定
    }
  }
  for (const name of ["index.ts", "index.js"]) {
    if (names.has(name)) return [path.join(dir, name)];
  }
  return null;
}

function scanExtensions(dir: string): string[] {
  const rootEntries = plainEntries(dir);
  const rootResolved = resolveExtensionEntries(dir, rootEntries);
  if (rootResolved) return rootResolved;

  const out: string[] = [];
  for (const entry of rootEntries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const fileLike = isFileEntry(entry, dir);
    if (fileLike && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      out.push(full);
      continue;
    }
    if (entry.isDirectory() || (entry.isSymbolicLink() && isDirLike(full))) {
      out.push(...(resolveExtensionEntries(full, plainEntries(full)) ?? []));
    }
  }
  return out;
}

function scanTopLevel(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of plainEntries(dir)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (isFileEntry(entry, dir) && entry.name.endsWith(ext)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function displayName(abs: string, type: ResourceType): string {
  const base = path.basename(abs);
  if (type === "skills") {
    return base === "SKILL.md" ? path.basename(path.dirname(abs)) : base.replace(/\.md$/i, "");
  }
  if (type === "extensions") {
    if (/^index\.(?:ts|js)$/i.test(base)) {
      const parent = path.basename(path.dirname(abs));
      return parent && parent !== "extensions" ? parent : base;
    }
    return base.replace(/\.(?:ts|js)$/i, "");
  }
  if (type === "prompts") return base.replace(/\.md$/i, "");
  return base.replace(/\.json$/i, "");
}

/** pi 的精确匹配候选：相对/绝对路径；技能额外认父目录。 */
interface MatchCandidates {
  exact: string[];
  /** 精确候选 + 技能父目录名（供 glob 匹配）。 */
  glob: string[];
}

function matchCandidates(abs: string, baseDir: string): MatchCandidates {
  const relative = toPosix(path.relative(baseDir, abs));
  const absolute = toPosix(abs);
  const exact = [relative, absolute];
  const glob = [relative, absolute];
  if (path.basename(abs) === "SKILL.md") {
    const parent = path.dirname(abs);
    const parentRelative = toPosix(path.relative(baseDir, parent));
    const parentAbsolute = toPosix(parent);
    exact.push(parentRelative, parentAbsolute);
    glob.push(parentRelative, parentAbsolute, path.basename(parent));
  }
  return { exact, glob };
}

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

interface CompiledOverrides {
  excludes: RegExp[];
  forceIncludes: Set<string>;
  forceExcludes: Set<string>;
}

/** 规则每目录只编译一次；逐项扫描时不再重复建正则。 */
function compileOverrides(overrides: string[]): CompiledOverrides {
  const excludes: RegExp[] = [];
  const forceIncludes = new Set<string>();
  const forceExcludes = new Set<string>();
  for (const raw of overrides) {
    const prefix = raw[0];
    if (prefix !== "!" && prefix !== "+" && prefix !== "-") continue;
    const pattern = normalizePattern(raw.slice(1));
    if (!pattern) continue;
    if (prefix === "!") excludes.push(globToRegExp(pattern));
    else if (prefix === "+") forceIncludes.add(pattern);
    else forceExcludes.add(pattern);
  }
  return { excludes, forceIncludes, forceExcludes };
}

function isEnabled(overrides: CompiledOverrides, candidates: MatchCandidates): boolean {
  if (
    overrides.excludes.length === 0 &&
    overrides.forceIncludes.size === 0 &&
    overrides.forceExcludes.size === 0
  ) {
    return true;
  }
  let enabled = true;
  if (overrides.excludes.some((re) => candidates.glob.some((candidate) => re.test(candidate)))) {
    enabled = false;
  }
  if (candidates.exact.some((candidate) => overrides.forceIncludes.has(candidate))) enabled = true;
  if (candidates.exact.some((candidate) => overrides.forceExcludes.has(candidate))) enabled = false;
  return enabled;
}

const nameCollator = new Intl.Collator();

function scanDir(
  location: LocalResourceLocation,
  overrides: CompiledOverrides,
): PiLocalResourceItem[] {
  let files: string[];
  if (location.resourceType === "extensions") files = scanExtensions(location.dir);
  else if (location.resourceType === "skills") {
    files = scanSkills(location.dir, location.skillMode ?? "pi");
  } else if (location.resourceType === "prompts") files = scanTopLevel(location.dir, ".md");
  else files = scanTopLevel(location.dir, ".json");

  return files
    .map((abs) => ({
      name: displayName(abs, location.resourceType),
      path: abs,
      relativePath: toPosix(path.relative(location.baseDir, abs)),
      enabled: isEnabled(overrides, matchCandidates(abs, location.baseDir)),
    }))
    .sort((a, b) => nameCollator.compare(a.name, b.name));
}

/** 列出全局本地资源目录及其条目；共享技能目录与 agentDir 无关。 */
export function listLocalResourceDirs(
  agentDir: string,
  settings: Record<string, unknown> | null,
  homeDir: string = os.homedir(),
): PiLocalResourceDir[] {
  const kinds: readonly PiLocalResourceKind[] = [
    "extensions",
    "skills",
    "sharedSkills",
    "prompts",
    "themes",
  ];
  const compiled = new Map<ResourceType, CompiledOverrides>();
  const overridesFor = (type: ResourceType): CompiledOverrides => {
    let value = compiled.get(type);
    if (!value) {
      value = compileOverrides(readStringArray(settings?.[type]));
      compiled.set(type, value);
    }
    return value;
  };
  return kinds.map((kind) => {
    const location = locationFor(kind, agentDir, homeDir);
    const exists = fs.existsSync(location.dir);
    return {
      kind,
      path: location.dir,
      exists,
      items: exists ? scanDir(location, overridesFor(location.resourceType)) : [],
    };
  });
}

function readSettings(agentDir: string): Record<string, unknown> {
  const file = path.join(agentDir, "settings.json");
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error(`pi 配置文件损坏（${file}），请手动修复后再试`);
}

function writeSettings(agentDir: string, settings: Record<string, unknown>): void {
  const file = path.join(agentDir, "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * 本地资源逐项启停：写 settings.<kind> 的 `+相对路径` / `-相对路径`。
 * 只替换指向同一资源的 +/- 项，保留用户手写的普通路径与 `!` 规则。
 */
export function setLocalResourceEnabled(
  agentDir: string,
  req: PiLocalResourceSetEnabledRequest,
  homeDir: string = os.homedir(),
): void {
  const location = locationFor(req.kind, agentDir, homeDir);
  const abs = path.resolve(req.path);
  const relToDir = path.relative(location.dir, abs);
  if (!relToDir || relToDir.startsWith("..") || path.isAbsolute(relToDir)) {
    throw new Error("资源路径不在本地资源目录内");
  }
  if (!fs.existsSync(abs)) throw new Error("资源不存在");

  const settings = readSettings(agentDir);
  const current = readStringArray(settings[location.resourceType]);
  const relativePath = toPosix(path.relative(location.baseDir, abs));
  const exact = matchCandidates(abs, location.baseDir).exact;

  const kept = current.filter((entry) => {
    if (!entry.startsWith("+") && !entry.startsWith("-")) return true;
    const pattern = normalizePattern(entry.slice(1));
    return !pattern || !exact.includes(pattern);
  });
  kept.push(`${req.enabled ? "+" : "-"}${relativePath}`);

  settings[location.resourceType] = kept;
  writeSettings(agentDir, settings);
}
