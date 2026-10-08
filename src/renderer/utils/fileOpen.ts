import type { FsReadResult, FsSearchHit } from "../../shared/ipc";
import { fsService } from "../services/fsService";

/** 去掉 :line[:column] 定位后缀。 */
export function stripLineCol(raw: string): string {
  return raw.replace(/:\d+(?::\d+)?$/, "");
}

/** 解析尾部 `:line[:column]`（1-based）；无定位时两者为 null。 */
export function parseLineCol(raw: string): { line: number | null; column: number | null } {
  const m = raw.match(/:(\d+)(?::(\d+))?$/);
  if (!m) return { line: null, column: null };
  const line = Number(m[1]);
  if (!Number.isFinite(line) || line < 1) return { line: null, column: null };
  const column = m[2] === undefined ? null : Number(m[2]);
  return {
    line,
    column: column !== null && Number.isFinite(column) && column >= 1 ? column : null,
  };
}

/** 取路径最后一段文件名（渲染层无 path 模块）。 */
export function pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? p;
}

/** 路径比较用 key：`/` 分隔 + 小写（Windows 不区分大小写）。 */
export function normalizePathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/** 归一为 `/` 分隔；保留盘符与 UNC 前缀。 */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

/**
 * 以 `/` 拼接相对路径到 base，支持 `..` / `.`。
 * 不可用 `replace(/^[.\\/]+/, "")`——那会把 `../foo` 误剥成 `foo`。
 */
export function joinPath(base: string, rel: string): string {
  const baseParts = toPosix(base).replace(/\/+$/, "").split("/").filter(Boolean);
  const stack = [...baseParts];
  for (const part of toPosix(rel).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      // 保留盘符/根，避免相对上溯吃掉 `C:`
      if (stack.length > 1) stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (base.startsWith("\\\\")) {
    return `//${stack.join("/")}`;
  }
  return stack.join("/");
}

/**
 * 相对路径按会话工作目录解析为绝对路径；已是绝对路径则原样返回。
 * 与 FileLink 系统打开共用，保证侧栏/系统两条路径解析一致。
 */
export function resolvePath(raw: string, cwd: string | null): string {
  const withoutLoc = stripLineCol(raw);
  if (isAbsolutePath(withoutLoc)) return withoutLoc;
  if (!cwd) return withoutLoc;
  return joinPath(cwd, withoutLoc.replace(/^\.\//, ""));
}

export type PreviewResolveResult =
  | { status: "ok"; path: string; result: FsReadResult }
  | { status: "missing" }
  | { status: "ambiguous"; hits: FsSearchHit[] };

async function tryRead(path: string): Promise<FsReadResult | null> {
  try {
    return await fsService.read(path);
  } catch {
    return null;
  }
}

function exactBasenameHits(hits: FsSearchHit[], name: string): FsSearchHit[] {
  const lower = name.toLowerCase();
  return hits.filter((hit) => {
    const base = pathBasename(hit.path).toLowerCase();
    const display = hit.displayPath.replace(/\\/g, "/").toLowerCase();
    return base === lower || display === lower || display.endsWith(`/${lower}`);
  });
}

type SearchOutcome =
  | { kind: "ok"; path: string; result: FsReadResult }
  | { kind: "ambiguous"; hits: FsSearchHit[] }
  | { kind: "missing" };

async function searchUniqueFile(root: string, name: string): Promise<SearchOutcome> {
  const hits = await fsService.search(root, name).catch(() => [] as FsSearchHit[]);
  const fileHits = hits.filter((hit) => hit.kind === "file");
  if (fileHits.length === 0) return { kind: "missing" };

  const exact = exactBasenameHits(fileHits, name);
  const pool = exact.length > 0 ? exact : fileHits;
  if (pool.length > 1) return { kind: "ambiguous", hits: pool };

  const result = await tryRead(pool[0].path);
  if (!result) return { kind: "missing" };
  return { kind: "ok", path: pool[0].path, result };
}

/**
 * 会话区 FileLink → 文件面板预览的路径解析链：
 * 1. 绝对路径 / 会话 cwd / 项目根 直开
 * 2. 项目根、会话 cwd（若不同）basename 搜索：唯一命中直开，多命中交回列表
 * 直开成功时一并返回读取结果，避免 FilePanel 再读一次。
 */
export async function resolveForPreview(
  rawPath: string,
  sessionCwd: string | null,
  projectRoot: string | null,
): Promise<PreviewResolveResult> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (p: string | null | undefined): void => {
    if (!p) return;
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(p);
  };

  const withoutLoc = stripLineCol(rawPath);
  if (isAbsolutePath(withoutLoc)) {
    push(withoutLoc);
  } else {
    push(sessionCwd ? joinPath(sessionCwd, withoutLoc.replace(/^\.\//, "")) : withoutLoc);
    if (projectRoot) push(joinPath(projectRoot, withoutLoc.replace(/^\.\//, "")));
  }

  for (const candidate of candidates) {
    const result = await tryRead(candidate);
    if (result) return { status: "ok", path: candidate, result };
  }

  const name = pathBasename(withoutLoc);
  if (!name || name === "." || name === "..") return { status: "missing" };

  const searchRoots: string[] = [];
  if (projectRoot) searchRoots.push(projectRoot);
  if (sessionCwd && sessionCwd.toLowerCase() !== (projectRoot ?? "").toLowerCase()) {
    searchRoots.push(sessionCwd);
  }

  let ambiguousHits: FsSearchHit[] | null = null;
  for (const root of searchRoots) {
    const outcome = await searchUniqueFile(root, name);
    if (outcome.kind === "ok") {
      return { status: "ok", path: outcome.path, result: outcome.result };
    }
    if (outcome.kind === "ambiguous" && ambiguousHits === null) {
      ambiguousHits = outcome.hits;
    }
  }

  if (ambiguousHits) return { status: "ambiguous", hits: ambiguousHits };
  return { status: "missing" };
}
