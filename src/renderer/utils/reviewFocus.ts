import type { GitChange } from "../../shared/ipc";
import { isAbsolutePath, normalizePathKey, stripLineCol } from "./fileOpen";

/** 命中来源：决定审查面板该切到哪个筛选口径（本轮改动 / 全部改动）。 */
export type ChangeFocusSource = "lastRound" | "all";

export interface ChangeFocusHit {
  change: GitChange;
  source: ChangeFocusSource;
}

/**
 * 把会话区（本轮编辑汇总卡等）展示的文件路径匹配到审查的变更条目。
 *
 * 展示路径有三种来源：仓库相对（Git lastRound）、会话目录相对（工具结果快照）、
 * 绝对路径（快照里落在已知根之外），因此匹配前先各归一一份候选 key。
 * rename/copy 的原路径也算命中，否则点开改名前的路径会查无此项。
 */
export function findChangeFocus(
  rawPath: string,
  lastRound: GitChange[],
  changes: GitChange[],
  repoRoot: string | null,
  cwd: string | null,
): ChangeFocusHit | null {
  const keys = candidateKeys(rawPath, repoRoot, cwd);
  if (keys.size === 0) return null;
  return scanList(lastRound, keys, "lastRound") ?? scanList(changes, keys, "all");
}

/** 在变更列表里找第一个命中候选 key 的条目。 */
function scanList(
  list: GitChange[],
  keys: Set<string>,
  source: ChangeFocusSource,
): ChangeFocusHit | null {
  for (const change of list) {
    if (keys.has(normalizePathKey(change.path))) return { change, source };
    if (change.oldPath && keys.has(normalizePathKey(change.oldPath))) return { change, source };
  }
  return null;
}

/** 归一为「相对仓库根、`/` 分隔、小写」的候选 key 集合（为空 = 无法匹配）。 */
function candidateKeys(rawPath: string, repoRoot: string | null, cwd: string | null): Set<string> {
  const norm = normalizePathKey(stripLineCol(rawPath)).replace(/^\.\//, "");
  const keys = new Set<string>();
  if (!norm) return keys;

  if (isAbsolutePath(norm)) {
    // 绝对路径：剥掉仓库根才算仓库内条目；剥不掉（仓库外/根目录）留空集合
    const rel = stripRoot(norm, repoRoot);
    if (rel) keys.add(rel);
    return keys;
  }

  keys.add(norm);
  // 展示路径可能相对会话目录：会话目录在仓库子目录时补一份相对仓库根的 key
  if (repoRoot && cwd) {
    const relCwd = stripRoot(normalizePathKey(cwd), repoRoot);
    if (relCwd) keys.add(`${relCwd}/${norm}`);
  }
  return keys;
}

/** 剥掉根前缀得到相对路径；不在该根下则返回 null。 */
function stripRoot(absPath: string, root: string | null): string | null {
  if (!root) return null;
  const base = normalizePathKey(root).replace(/\/+$/, "");
  if (!base || !absPath.startsWith(`${base}/`)) return null;
  return absPath.slice(base.length + 1) || null;
}
