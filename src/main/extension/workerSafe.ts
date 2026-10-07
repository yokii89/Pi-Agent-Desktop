/**
 * 解析 worker-safe 扩展入口（docs/design/16 §9、Phase F）。
 * 只读 packageStore + pidesk.manifest；默认 safe=false，未声明不得加载。
 */

import fs from "node:fs";
import path from "node:path";
import { parsePideskManifest } from "./contributionSchema";
import { listPackages } from "./packageStore";

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

function packageWorkerSafe(installPath: string | null): boolean {
  if (!installPath) return false;
  const pkg = readJsonFile(path.join(installPath, "package.json"));
  if (!pkg) return false;
  return parsePideskManifest(pkg.pidesk).workerSafe;
}

/**
 * 列出可交给 Extension Worker 的扩展文件绝对路径。
 * 仅：已启用 + 已安装 + `pidesk.worker.safe === true` + 资源级启用的 extensions。
 */
export function listWorkerSafeExtensionPaths(projectDir?: string | null): string[] {
  const snapshot = listPackages(typeof projectDir === "string" && projectDir ? projectDir : null);
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...snapshot.user, ...snapshot.project]) {
    if (!entry.enabled || !entry.installed) continue;
    if (!packageWorkerSafe(entry.installPath)) continue;
    for (const item of entry.resourceItems.extensions) {
      if (!item.enabled) continue;
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      paths.push(item.path);
    }
  }
  return paths;
}
