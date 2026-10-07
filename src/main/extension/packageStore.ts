import fs from "node:fs";
import path from "node:path";
import type {
  PiLocalResourceDir,
  PiPackageEntry,
  PiPackageResourceCounts,
  PiPackageResourceItems,
  PiPackageResourceKind,
  PiPackageScope,
  PiPackageSetEnabledRequest,
  PiPackageSetResourceEnabledRequest,
  PiPackagesSnapshot,
} from "../../shared/ipc";
import { getPiAgentDir } from "../session/piInfo";
import {
  applyResourceEnabled,
  isDisabledSettingsItem,
  isResourceFilterEnabled,
  makeDisabledSettingsItem,
  parsePackageSource,
  RESOURCE_KIND_KEYS,
  resolveInstallPath,
  resourceFilterArray,
  sourceFromSettingsItem,
} from "./packageSource";

/**
 * pi settings.packages / 本地资源目录的读写与快照组装。
 * 不 spawn pi；安装/卸载见 packageCli。
 */

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    // 剥离 UTF-8 BOM（PowerShell 等工具写 JSON 会带）
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function packagesArray(settings: Record<string, unknown> | null): unknown[] {
  const raw = settings?.packages;
  return Array.isArray(raw) ? raw : [];
}

const RESOURCE_KINDS = RESOURCE_KIND_KEYS;

function emptyResourceItems(): PiPackageResourceItems {
  return { extensions: [], skills: [], prompts: [], themes: [] };
}

/** 资源展示名：index 文件取父目录名，其余去掉约定后缀。 */
function resourceDisplayName(abs: string, kind: PiPackageResourceKind): string {
  const base = path.basename(abs);
  if (kind === "extensions") {
    if (/^index\.(?:ts|js|mjs|cjs|mts|cts)$/i.test(base)) {
      return path.basename(path.dirname(abs)) || base;
    }
    return base.replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/i, "");
  }
  if (kind === "prompts") return base.replace(/\.md$/i, "");
  if (kind === "themes") return base.replace(/\.json$/i, "");
  return base;
}

function toRelativePosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function pushItem(
  items: PiPackageResourceItems,
  kind: PiPackageResourceKind,
  root: string,
  abs: string,
): void {
  items[kind].push({
    name: resourceDisplayName(abs, kind),
    path: abs,
    relativePath: toRelativePosix(root, abs),
    enabled: true,
  });
}

/** 从包根目录扫资源明细（manifest 优先，缺省用约定目录）。 */
function readPackageResources(root: string): {
  resources: PiPackageResourceCounts;
  resourceItems: PiPackageResourceItems;
  version: string | null;
  description: string | null;
} {
  const resourceItems = emptyResourceItems();
  let version: string | null = null;
  let description: string | null = null;

  if (!fs.existsSync(root)) {
    return {
      resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
      resourceItems,
      version,
      description,
    };
  }

  const pkg = readJsonFile(path.join(root, "package.json"));
  if (pkg) {
    if (typeof pkg.version === "string") version = pkg.version;
    if (typeof pkg.description === "string") description = pkg.description;
  }

  const piManifest =
    pkg && typeof pkg.pi === "object" && pkg.pi !== null
      ? (pkg.pi as Record<string, unknown>)
      : null;

  type Matcher = {
    matchFile: (name: string, abs: string) => boolean;
    matchDirEntry?: (name: string, abs: string) => boolean;
  };

  const matchers: Record<PiPackageResourceKind, Matcher> = {
    extensions: { matchFile: (name) => /\.(ts|js)$/i.test(name) },
    skills: {
      matchFile: () => false,
      matchDirEntry: (name, abs) => {
        if (name.startsWith(".")) return false;
        try {
          return fs.statSync(abs).isDirectory() && fs.existsSync(path.join(abs, "SKILL.md"));
        } catch {
          return false;
        }
      },
    },
    prompts: { matchFile: (name) => /\.md$/i.test(name) },
    themes: { matchFile: (name) => /\.json$/i.test(name) },
  };

  /** 按 manifest 条目或约定目录收集某类资源；目录会展开一层。 */
  const collectList = (kind: PiPackageResourceKind): void => {
    const matcher = matchers[kind];
    const list = piManifest?.[kind];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item !== "string" || item.startsWith("!")) continue;
        const abs = path.resolve(root, item);
        try {
          if (fs.statSync(abs).isDirectory()) {
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              if (entry.name.startsWith(".")) continue;
              const child = path.join(abs, entry.name);
              if (entry.isDirectory()) {
                if (matcher.matchDirEntry?.(entry.name, child)) {
                  pushItem(resourceItems, kind, root, child);
                }
              } else if (matcher.matchFile(entry.name, child)) {
                pushItem(resourceItems, kind, root, child);
              }
            }
          } else if (matcher.matchFile(path.basename(abs), abs)) {
            pushItem(resourceItems, kind, root, abs);
          }
        } catch {
          // 路径不存在时忽略
        }
      }
      return;
    }
    const dir = path.join(root, kind);
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (matcher.matchDirEntry?.(entry.name, abs)) {
            pushItem(resourceItems, kind, root, abs);
          }
        } else if (matcher.matchFile(entry.name, abs)) {
          pushItem(resourceItems, kind, root, abs);
        }
      }
    } catch {
      // 约定目录不存在
    }
  };

  for (const kind of RESOURCE_KINDS) collectList(kind);

  const resources: PiPackageResourceCounts = {
    extensions: resourceItems.extensions.length,
    skills: resourceItems.skills.length,
    prompts: resourceItems.prompts.length,
    themes: resourceItems.themes.length,
  };

  return { resources, resourceItems, version, description };
}

function entryFromSettingsItem(
  item: unknown,
  scope: "user" | "project",
  agentDir: string,
  cwd: string | null,
): PiPackageEntry | null {
  const source = sourceFromSettingsItem(item);
  if (!source) return null;

  let parsed: ReturnType<typeof parsePackageSource>;
  try {
    parsed = parsePackageSource(source);
  } catch {
    // 无法解析时仍展示原始串，kind 退 local
    parsed = { kind: "local", name: source, identity: source, pinned: false, raw: source };
  }

  const local = scope === "project";
  const installPath = resolveInstallPath(parsed, { agentDir, local, cwd });
  const installed = installPath ? fs.existsSync(installPath) : false;
  const meta = installPath
    ? readPackageResources(installPath)
    : {
        resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
        resourceItems: emptyResourceItems(),
        version: null,
        description: null,
      };

  const packageEnabled = !isDisabledSettingsItem(item);
  if (packageEnabled) {
    for (const kind of RESOURCE_KINDS) {
      const filters = resourceFilterArray(item, kind);
      for (const res of meta.resourceItems[kind]) {
        res.enabled = isResourceFilterEnabled(filters, res.relativePath);
      }
    }
  }

  return {
    source,
    kind: parsed.kind,
    name: parsed.name,
    enabled: packageEnabled,
    installed,
    installPath,
    version: meta.version,
    description: meta.description,
    resources: meta.resources,
    resourceItems: meta.resourceItems,
  };
}

function listLocalResourceDirs(agentDir: string): PiLocalResourceDir[] {
  const kinds = ["extensions", "skills", "prompts", "themes"] as const;
  return kinds.map((kind) => {
    const p = path.join(agentDir, kind);
    return { kind, path: p, exists: fs.existsSync(p) };
  });
}

/** 组装扩展页快照。projectDir 为空时 project 列表为空。 */
export function listPackages(projectDir: string | null): PiPackagesSnapshot {
  const agentDir = getPiAgentDir();
  const userSettings = readJsonFile(path.join(agentDir, "settings.json"));
  const projectSettings = projectDir
    ? readJsonFile(path.join(projectDir, ".pi", "settings.json"))
    : null;

  const user = packagesArray(userSettings)
    .map((item) => entryFromSettingsItem(item, "user", agentDir, null))
    .filter((e): e is PiPackageEntry => e !== null);

  const project = projectDir
    ? packagesArray(projectSettings)
        .map((item) => entryFromSettingsItem(item, "project", agentDir, projectDir))
        .filter((e): e is PiPackageEntry => e !== null)
    : [];

  return {
    user,
    project,
    localResources: listLocalResourceDirs(agentDir),
    agentDir,
  };
}

/**
 * 启停：写对应 scope 的 settings.packages。
 * 停用 → 对象项 + 四类空过滤；启用 → 字符串源（去掉旧的过滤对象）。
 */
export function setPackageEnabled(req: PiPackageSetEnabledRequest): void {
  const source = (req.source ?? "").trim();
  if (!source) throw new Error("缺少包来源");

  const agentDir = getPiAgentDir();
  const isProject = req.scope === "project";
  if (isProject && !req.cwd) throw new Error("缺少项目目录");

  const file = isProject
    ? path.join(req.cwd as string, ".pi", "settings.json")
    : path.join(agentDir, "settings.json");

  let settings = readJsonFile(file);
  if (!settings) {
    // 项目 settings 可能不存在；全局损坏则拒绝写
    if (!isProject && fs.existsSync(file)) {
      throw new Error(`pi 配置文件损坏（${file}），请手动修复后再试`);
    }
    settings = {};
  }

  const nextPackages: unknown[] = [];
  let matched = false;
  for (const item of packagesArray(settings)) {
    const itemSource = sourceFromSettingsItem(item);
    if (itemSource !== source) {
      nextPackages.push(item);
      continue;
    }
    matched = true;
    nextPackages.push(req.enabled ? source : makeDisabledSettingsItem(source));
  }
  if (!matched) {
    // 允许对「仅存在于磁盘」的包做启用：追加一项
    if (req.enabled) nextPackages.push(source);
    else throw new Error("未在设置中找到该包");
  }

  settings.packages = nextPackages;
  writeJsonFile(file, settings);
}

function resolveSettingsFile(scope: PiPackageScope, cwd: string | null | undefined): string {
  const agentDir = getPiAgentDir();
  if (scope === "project") {
    if (!cwd) throw new Error("缺少项目目录");
    return path.join(cwd, ".pi", "settings.json");
  }
  return path.join(agentDir, "settings.json");
}

function readSettingsOrEmpty(file: string, scope: PiPackageScope): Record<string, unknown> {
  const settings = readJsonFile(file);
  if (settings) return settings;
  // 项目 settings 可能不存在；全局损坏则拒绝写
  if (scope === "user" && fs.existsSync(file)) {
    throw new Error(`pi 配置文件损坏（${file}），请手动修复后再试`);
  }
  return {};
}

/**
 * 单资源启停：写 settings.packages 的对象过滤（`-path` / 移除排除）。
 * 无剩余过滤时收成字符串源；包整体停用态下启用单资源只打开该条。
 */
export function setPackageResourceEnabled(req: PiPackageSetResourceEnabledRequest): void {
  const source = (req.source ?? "").trim();
  if (!source) throw new Error("缺少包来源");
  const kind = req.kind;
  const relativePath = (req.relativePath ?? "").trim().replace(/\\/g, "/");
  if (!relativePath) throw new Error("缺少资源路径");
  if (!RESOURCE_KINDS.includes(kind)) throw new Error("资源类型无效");

  const file = resolveSettingsFile(req.scope, req.cwd);
  const settings = readSettingsOrEmpty(file, req.scope);

  const nextPackages: unknown[] = [];
  let matched = false;
  for (const item of packagesArray(settings)) {
    const itemSource = sourceFromSettingsItem(item);
    if (itemSource !== source) {
      nextPackages.push(item);
      continue;
    }
    matched = true;
    nextPackages.push(applyResourceEnabled(item, kind, relativePath, req.enabled === true));
  }
  if (!matched) {
    if (!req.enabled) throw new Error("未在设置中找到该包");
    // 仅存在于磁盘的包：先登记，再只启用该资源
    const created = applyResourceEnabled(source, kind, relativePath, true);
    nextPackages.push(created);
  }

  settings.packages = nextPackages;
  writeJsonFile(file, settings);
}
