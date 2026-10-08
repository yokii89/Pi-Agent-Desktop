/**
 * Contribution Catalog 主进程管理器（docs/design/16 §5.4）。
 * 复用 packageStore 的扫描/启停结果；按 context 内存快照，P0 不落盘。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ContributionCatalogSnapshot,
  ContributionDiagnostic,
  ExtensionContribution,
} from "../../shared/contribution";
import { CATALOG_IPC } from "../../shared/contribution";
import type { PiPackageEntry } from "../../shared/ipc";
import { getMainWindow } from "../window/createMainWindow";
import {
  computeCatalogFingerprint,
  computeContextId,
  contributionsFromPackage,
  normalizeProjectDir,
  type PackageManifestInput,
  packageKeyIdentity,
  parsePideskManifest,
} from "./contributionSchema";
import { listPackages } from "./packageStore";

interface CatalogCacheEntry {
  snapshot: ContributionCatalogSnapshot;
  builtAt: number;
}

const cache = new Map<string, CatalogCacheEntry>();

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 读取包根上的 pidesk 字段。
 *
 * 查找顺序：
 * 1. 目录：`<dir>/package.json` 的 `pidesk`
 * 2. 文件（扩展入口）：sidecar `*.pidesk.json` → 同级 `package.json` 的 `pidesk`
 *
 * 同级 package.json 必须跟上：monorepo 本地包（如 `packages/pi-telegram-main/index.ts`）
 * 的能力声明在子包 package.json 里，不在根包，也不写 sidecar。漏掉这一步会让 Catalog
 * 看不到 `pidesk.contributes`，右侧栏冷态入口整棵消失。
 */
function readPideskField(installPath: string | null): unknown {
  if (!installPath || !fs.existsSync(installPath)) return null;
  if (fs.statSync(installPath).isFile()) {
    return (
      readJsonFile(`${installPath}.pidesk.json`) ??
      readJsonFile(installPath.replace(/\.[^.]+$/, ".pidesk.json")) ??
      readJsonFile(path.join(path.dirname(installPath), "package.json"))?.pidesk
    );
  }
  const pkgPath = path.join(installPath, "package.json");
  const pkg = readJsonFile(pkgPath);
  if (pkg && pkg.pidesk !== undefined) return pkg.pidesk;

  return null;
}

function packageInputsForScope(
  entries: PiPackageEntry[],
  scope: "user" | "project",
  projectDir: string | undefined,
): PackageManifestInput[] {
  return entries.flatMap((entry) => {
    let sourceIdentity = entry.name;
    try {
      // 复用 parse 的 identity 语义：key 材料用 name/kind，local 走 hash
      sourceIdentity = packageKeyIdentity(
        entry.kind,
        entry.kind === "local" ? (entry.installPath ?? entry.name) : entry.name,
      );
    } catch {
      sourceIdentity = packageKeyIdentity("unknown", entry.name);
    }
    const input: PackageManifestInput = {
      packageId: entry.name,
      sourceIdentity,
      scope,
      projectDir,
      packageVersion: entry.version ?? undefined,
      pideskField: readPideskField(entry.installPath),
      enabled:
        entry.enabled &&
        entry.installed &&
        entry.resourceItems.extensions.some((item) => item.enabled),
    };
    if (input.pideskField != null || !input.enabled) return [input];
    const sidecars = entry.resourceItems.extensions
      .filter((item) => item.enabled)
      .map((item) => ({ ...input, pideskField: readPideskField(item.path) }))
      .filter((item) => item.pideskField != null);
    return sidecars.length ? sidecars : [input];
  });
}

/** 构建指定上下文的 Catalog 快照（不读缓存）。 */
export function buildCatalogSnapshot(
  projectDir: string | null | undefined,
): ContributionCatalogSnapshot {
  const normalized = normalizeProjectDir(projectDir);
  const contextId = computeContextId(normalized);
  const snapshot = listPackages(normalized);

  const inputs = [
    ...packageInputsForScope(snapshot.user, "user", undefined),
    ...packageInputsForScope(snapshot.project, "project", normalized ?? undefined),
  ];
  // 松散扩展与 package 使用相同 schema；逐入口读取，不能只取第一个 sidecar。
  const localDirs = [
    { dir: path.join(snapshot.agentDir, "extensions"), scope: "user" as const },
    ...(normalized
      ? [{ dir: path.join(normalized, ".pi", "extensions"), scope: "project" as const }]
      : []),
  ];
  for (const { dir, scope } of localDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, item.name);
      const extensionPath = item.isDirectory()
        ? ["index.ts", "index.js"]
            .map((name) => path.join(entryPath, name))
            .find((file) => fs.existsSync(file))
        : /\.[cm]?[jt]s$/.test(item.name)
          ? entryPath
          : undefined;
      if (!extensionPath) continue;
      inputs.push({
        packageId: item.name,
        sourceIdentity: packageKeyIdentity("local", extensionPath),
        scope,
        projectDir: scope === "project" ? (normalized ?? undefined) : undefined,
        pideskField: readPideskField(extensionPath),
        enabled: true,
      });
    }
  }

  const entries: ExtensionContribution[] = [];
  const diagnostics: ContributionDiagnostic[] = [];
  const seenKeys = new Set<string>();

  for (const input of inputs) {
    const result = contributionsFromPackage(input, contextId);
    for (const entry of result.entries) {
      if (seenKeys.has(entry.key)) {
        diagnostics.push({
          packageId: input.packageId,
          scope: input.scope,
          message: `contributionKey 冲突，已忽略：${entry.key}`,
          field: entry.id,
        });
        continue;
      }
      seenKeys.add(entry.key);
      entries.push(entry);
    }
    diagnostics.push(...result.diagnostics);
  }

  return {
    contextId,
    projectDir: normalized ?? undefined,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          contributions: computeCatalogFingerprint(entries),
          packages: [...snapshot.user, ...snapshot.project].map((entry) => ({
            source: entry.source,
            version: entry.version,
            enabled: entry.enabled,
            installed: entry.installed,
            resources: entry.resourceItems,
          })),
        }),
      )
      .digest("hex")
      .slice(0, 16),
    entries,
    diagnostics,
  };
}

function pushChanged(snapshot: ContributionCatalogSnapshot): void {
  getMainWindow()?.webContents.send(CATALOG_IPC.changed, snapshot);
}

/**
 * 获取 Catalog 快照。
 * @param projectDir 会话/项目目录；null 表示仅 user 作用域。
 */
export function getCatalogSnapshot(
  projectDir: string | null | undefined,
): ContributionCatalogSnapshot {
  const contextId = computeContextId(projectDir);
  const cached = cache.get(contextId);
  if (cached) return cached.snapshot;
  const snapshot = buildCatalogSnapshot(projectDir);
  cache.set(contextId, { snapshot, builtAt: Date.now() });
  return snapshot;
}

/** 按 contextId 或 projectDir 失效；不传则失效全部。 */
export function invalidateCatalog(opts?: { contextId?: string; projectDir?: string | null }): void {
  if (!opts || (opts.contextId === undefined && opts.projectDir === undefined)) {
    const previous = [...cache.values()].map((v) => v.snapshot);
    cache.clear();
    // 广播：全部失效时对每个曾存在的 context 推新快照
    for (const prev of previous) {
      try {
        const next = getCatalogSnapshot(prev.projectDir ?? null);
        pushChanged(next);
      } catch {
        // 扫描失败时不推送，等待下次 list
      }
    }
    return;
  }

  const contextId = opts.contextId ?? computeContextId(opts.projectDir);
  cache.delete(contextId);
  try {
    const next = getCatalogSnapshot(opts.projectDir ?? null);
    pushChanged(next);
  } catch {
    // ignore
  }
}

/** 在已缓存/即时扫描的快照中查找 contributionKey。 */
export function findContribution(
  contributionKey: string,
  projectDirs: ReadonlyArray<string | null | undefined>,
): ExtensionContribution | null {
  for (const dir of projectDirs) {
    const snap = getCatalogSnapshot(dir);
    const hit = snap.entries.find((e) => e.key === contributionKey);
    if (hit) return hit;
  }
  // 兜底：扫描全部已缓存 context
  for (const entry of cache.values()) {
    const hit = entry.snapshot.entries.find((e) => e.key === contributionKey);
    if (hit) return hit;
  }
  return null;
}

/** 查找 key 所属的 contribution（遍历缓存 + 按需构建 user/project）。 */
export function findContributionAnywhere(
  contributionKey: string,
  hintProjectDir?: string | null,
): { contribution: ExtensionContribution; snapshot: ContributionCatalogSnapshot } | null {
  const dirs: Array<string | null | undefined> = [hintProjectDir, null];
  // 若 hint 为空，也尝试缓存里出现过的 projectDir
  for (const cached of cache.values()) {
    if (cached.snapshot.projectDir) dirs.push(cached.snapshot.projectDir);
  }
  for (const dir of dirs) {
    const snapshot = getCatalogSnapshot(dir);
    const hit = snapshot.entries.find((e) => e.key === contributionKey);
    if (hit) return { contribution: hit, snapshot };
  }
  return null;
}

/** 诊断列表（扩展页展示）。 */
export function listCatalogDiagnostics(
  projectDir: string | null | undefined,
): ContributionDiagnostic[] {
  return getCatalogSnapshot(projectDir).diagnostics;
}

/** 测试用：清空缓存。 */
export function __resetCatalogCacheForTests(): void {
  cache.clear();
}

/** 测试用：直接注入快照。 */
export function __seedCatalogCacheForTests(snapshot: ContributionCatalogSnapshot): void {
  cache.set(snapshot.contextId, { snapshot, builtAt: Date.now() });
}

// re-export 供 IPC / 测试使用
export { computeContextId, packageKeyIdentity, parsePideskManifest };
