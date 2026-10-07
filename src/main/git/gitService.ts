import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  GitBranchesResult,
  GitBranchInfo,
  GitChange,
  GitChangeStatus,
  GitCheckoutRequest,
  GitCommit,
  GitCommitRequest,
  GitCommitResult,
  GitCompareItem,
  GitCompareSnapshotRequest,
  GitCompareSnapshotResult,
  GitDiffHunk,
  GitDiffLine,
  GitDiffRequest,
  GitDiscardRequest,
  GitDiscardResult,
  GitFileDiff,
  GitLogRequest,
  GitLogResult,
  GitPushPlan,
  GitPushRequest,
  GitPushResult,
  GitRollbackRequest,
  GitRollbackResult,
  GitSnapshotResult,
  GitStageRequest,
  GitStatusResult,
  GitWriteResult,
} from "../../shared/ipc";
import { readToken } from "../github/authStore";
import { fetchGitHubAuthorAvatars, parseGitHubRepo } from "./gitAvatar";

/**
 * Git 审查数据层（docs/design/04）：
 * 所有 git 命令集中在该模块，统一 execFile 参数数组调用（无 shell 拼接），
 * diff 基线显式按 layer 区分：staged=HEAD→Index，unstaged=Index→工作区，untracked=无→文件。
 */

/** diff 单文件解析行数上限（超大 diff 截断，避免渲染层卡顿）。 */
const MAX_DIFF_LINES = 4000;
/** git 子进程输出上限。 */
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
/** git 子进程超时。 */
const GIT_TIMEOUT_MS = 15000;
/** 未跟踪文件统计行数的读取上限（超限不统计，diff 视图另行截断）。 */
const MAX_UNTRACKED_READ_BYTES = 1024 * 1024;
/** 二进制探测字节数（与 git 相同的启发式：前 8KB 内出现 NUL 即视为二进制）。 */
const BINARY_SNIFF_BYTES = 8000;

/** 业务性 git 失败（非仓库以外的命令错误），message 可直接展示给用户。 */
class GitError extends Error {}

interface GitRunOptions {
  /** 视为成功的额外退出码（如 `diff --no-index` 有差异时退出码为 1）。 */
  allowedExitCodes?: number[];
  /** 追加/覆盖环境变量（如临时 index 的 GIT_INDEX_FILE）。 */
  env?: NodeJS.ProcessEnv;
  /** 以 Buffer 返回 stdout（二进制文件内容）。 */
  encoding?: "buffer";
}

/** 以参数数组方式执行 git（不经 shell，天然规避空格/引号/注入问题）。 */
function runGit(
  cwd: string,
  args: string[],
  options: Omit<GitRunOptions, "encoding"> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        env: options.env ? { ...process.env, ...options.env } : undefined,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : undefined;
        if (exitCode !== undefined && (options.allowedExitCodes ?? []).includes(exitCode)) {
          resolve(stdout);
          return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new GitError("未找到 git 可执行文件，请确认已安装 Git 并加入 PATH"));
          return;
        }
        const firstLine = stderr.split("\n")[0]?.trim() ?? "";
        reject(new GitError(firstLine || `git ${args[0]} 执行失败（exit ${exitCode ?? "?"}）`));
      },
    );
  });
}

/** Buffer 版 git 调用：用于读取 blob 原文（含二进制）。 */
function runGitBuffer(cwd: string, args: string[], options: GitRunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        env: options.env ? { ...process.env, ...options.env } : undefined,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout as Buffer);
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : undefined;
        if (exitCode !== undefined && (options.allowedExitCodes ?? []).includes(exitCode)) {
          resolve(stdout as Buffer);
          return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new GitError("未找到 git 可执行文件，请确认已安装 Git 并加入 PATH"));
          return;
        }
        reject(new GitError(`git ${args[0]} 执行失败（exit ${exitCode ?? "?"}）`));
      },
    );
  });
}

function isNotRepoError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not a git repository/i.test(message);
}

/** 解析仓库根；cwd 不在仓库内时返回 null（区别于其他错误）。 */
async function resolveRepoRoot(cwd: string): Promise<string | null> {
  try {
    const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return root || null;
  } catch (err) {
    if (isNotRepoError(err)) return null;
    throw err;
  }
}

/** porcelain v2 中的 XY 状态码是否代表一层真实变更。 */
function isChangeCode(code: string | undefined): boolean {
  return code !== undefined && code !== "." && code !== " " && code !== "!" && code !== "?";
}

function mapStatusCode(code: string): GitChangeStatus {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    // T = 类型变化（符号链接 ↔ 常规文件），按修改呈现
    default:
      return "modified";
  }
}

interface RawChange {
  path: string;
  oldPath: string | null;
  status: GitChangeStatus;
  layer: GitChange["layer"];
}

/**
 * 解析 `git status --porcelain=v2 -z --untracked-files=all`。
 * -z 下条目以 NUL 分隔；rename 条目额外占用两个 NUL 字段（新路径、旧路径），
 * 路径中的空格/Unicode/换行均不会被破坏。
 */
function parseStatusZ(output: string): RawChange[] {
  const tokens = output.split("\0");
  const changes: RawChange[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.startsWith("#")) continue;
    if (token.startsWith("? ")) {
      changes.push({
        layer: "untracked",
        status: "untracked",
        path: token.slice(2),
        oldPath: null,
      });
      continue;
    }
    const fields = token.split(" ");
    if (fields[0] === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      // 路径是最后一个字段且可含空格，需将第 8 列之后的字段拼回
      const xy = fields[1] ?? "";
      const filePath = fields.length > 8 ? fields.slice(8).join(" ") : "";
      if (!filePath) continue;
      const push = (code: string, layer: RawChange["layer"]): void => {
        changes.push({
          layer,
          status: mapStatusCode(code),
          path: filePath,
          oldPath: null,
        });
      };
      if (isChangeCode(xy[0])) push(xy[0], "staged");
      if (isChangeCode(xy[1])) push(xy[1], "unstaged");
    } else if (fields[0] === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <R|C><score> <newPath> <NUL> <oldPath>
      // 第 8 列为 R/C+相似度，其后为可含空格的新路径；旧路径在下一个 NUL 字段中
      const xy = fields[1] ?? "";
      const kind = fields[8]?.[0] === "C" ? "C" : "R";
      const newPath = fields.length > 9 ? fields.slice(9).join(" ") : "";
      i += 1;
      const oldPath = tokens[i] ?? "";
      if (!newPath) continue;
      const push = (code: string, layer: RawChange["layer"]): void => {
        changes.push({
          layer,
          status: mapStatusCode(kind === "C" ? kind : code),
          path: newPath,
          oldPath: oldPath || null,
        });
      };
      if (isChangeCode(xy[0])) push(kind, "staged");
      if (isChangeCode(xy[1])) push(xy[1], "unstaged");
    } else if (fields[0] === "u") {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const filePath = fields.length > 10 ? fields.slice(10).join(" ") : "";
      if (filePath) {
        changes.push({
          layer: "unstaged",
          status: "conflicted",
          path: filePath,
          oldPath: null,
        });
      }
    }
  }
  return changes;
}

interface NumstatEntry {
  additions: number | null;
  deletions: number | null;
}

/**
 * 解析 `git diff --numstat -z`。
 * 普通条目为 `add\tdelete\tpath`；rename 条目的路径字段为空，随后两个 NUL 字段为旧路径、新路径；
 * 二进制文件 add/delete 为 `-`；冲突文件的 combined diff 可能对同一路径输出多行，后行覆盖前行。
 */
function parseNumstatZ(output: string): Map<string, NumstatEntry> {
  const tokens = output.split("\0");
  const counts = new Map<string, NumstatEntry>();
  const toCount = (add: string, del: string): NumstatEntry => ({
    additions: add === "-" ? null : Number.parseInt(add, 10),
    deletions: del === "-" ? null : Number.parseInt(del, 10),
  });
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const cols = token.split("\t");
    if (cols.length < 3) continue;
    if (cols[2] === "") {
      const oldPath = tokens[i + 1] ?? "";
      const newPath = tokens[i + 2] ?? "";
      i += 2;
      if (newPath) counts.set(`${oldPath}\0${newPath}`, toCount(cols[0], cols[1]));
    } else {
      counts.set(`\0${cols[2]}`, toCount(cols[0], cols[1]));
    }
  }
  return counts;
}

/** 与 git 相同的二进制启发式：开头 8KB 内出现 NUL 字节即视为二进制。 */
function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** 未跟踪文件的行数统计：整个文件语义上全部为新增（/dev/null → 文件）。 */
async function countUntrackedLines(
  repoRoot: string,
  relPath: string,
): Promise<{ additions: number | null; deletions: number | null }> {
  try {
    const abs = path.join(repoRoot, relPath);
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_READ_BYTES) {
      return { additions: null, deletions: null };
    }
    const buffer = await fs.promises.readFile(abs);
    if (looksBinary(buffer)) return { additions: null, deletions: null };
    let lines = 0;
    for (const byte of buffer) {
      if (byte === 0x0a) lines += 1;
    }
    if (buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) lines += 1;
    return { additions: lines, deletions: null };
  } catch {
    // 文件读取失败（如竞态删除）不阻塞整个变更列表
    return { additions: null, deletions: null };
  }
}

/** 读取当前 HEAD OID；无 HEAD（空仓库）返回 null。 */
async function resolveHeadOid(repoRoot: string): Promise<string | null> {
  try {
    const oid = (await runGit(repoRoot, ["rev-parse", "HEAD"])).trim();
    return oid || null;
  } catch {
    return null;
  }
}

/**
 * 读取工作区变更总览：仓库探测 + status + staged/unstaged numstat + untracked 行数统计。
 * cwd 不是 git 仓库时返回 repoRoot=null（非错误）。
 */
export async function getChanges(cwd: string): Promise<GitStatusResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) return { repoRoot: null, changes: [], headOid: null };

  const statusOutput = await runGit(repoRoot, [
    "status",
    "--porcelain=v2",
    "--untracked-files=all",
    "-z",
  ]);
  const raw = parseStatusZ(statusOutput);

  const [stagedNumstat, unstagedNumstat, headOid] = await Promise.all([
    runGit(repoRoot, ["diff", "--cached", "--numstat", "-z", "--find-renames"]),
    runGit(repoRoot, ["diff", "--numstat", "-z", "--find-renames"]),
    resolveHeadOid(repoRoot),
  ]);
  const stagedCounts = parseNumstatZ(stagedNumstat);
  const unstagedCounts = parseNumstatZ(unstagedNumstat);

  const pendingUntracked: GitChange[] = [];
  const changes: GitChange[] = raw.map((change) => {
    const counts =
      change.layer === "staged"
        ? stagedCounts.get(`${change.oldPath ?? ""}\0${change.path}`)
        : change.layer === "unstaged"
          ? unstagedCounts.get(`${change.oldPath ?? ""}\0${change.path}`)
          : undefined;
    const next: GitChange = {
      ...change,
      additions: counts ? counts.additions : null,
      deletions: counts ? counts.deletions : null,
    };
    if (change.layer === "untracked") pendingUntracked.push(next);
    return next;
  });

  await Promise.all(
    pendingUntracked.map(async (change) => {
      const counted = await countUntrackedLines(repoRoot, change.path);
      change.additions = counted.additions;
      change.deletions = counted.deletions;
    }),
  );

  return { repoRoot, changes, headOid };
}

/**
 * 读取单个文件的 diff（结构化 hunks，渲染层不再拼接 git 文本）。
 * untracked 用 `diff --no-index /dev/null`；rename 需同时传新写路径以便 git 配对。
 */
export async function getFileDiff(cwd: string, req: GitDiffRequest): Promise<GitFileDiff> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");

  const pathspecs = req.oldPath ? [req.path, req.oldPath] : [req.path];
  let output: string;
  if (req.layer === "untracked") {
    output = await runGit(
      repoRoot,
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=3",
        "--",
        "/dev/null",
        path.join(repoRoot, req.path),
      ],
      { allowedExitCodes: [1] },
    );
  } else if (req.layer === "staged") {
    output = await runGit(repoRoot, [
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--find-renames",
      "--",
      ...pathspecs,
    ]);
  } else {
    output = await runGit(repoRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--find-renames",
      "--",
      ...pathspecs,
    ]);
  }

  return parseUnifiedDiff(output, req.path, req.oldPath ?? null);
}

/** 解析统一 diff 为 hunks；combined diff（冲突）与二进制文件只标记、不解析。 */
export function parseUnifiedDiff(
  output: string,
  filePath: string,
  oldPath: string | null,
): GitFileDiff {
  const diff: GitFileDiff = {
    path: filePath,
    oldPath,
    binary: false,
    conflicted: false,
    truncated: false,
    hunks: [],
  };

  const rawLines = output.split("\n");
  if (rawLines.at(-1) === "") rawLines.pop();

  let current: GitDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let contentLines = 0;

  for (const rawLine of rawLines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --cc") || line.startsWith("diff --combined")) {
      diff.conflicted = true;
      continue;
    }
    if (line.startsWith("@@@")) {
      diff.conflicted = true;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      diff.binary = true;
      continue;
    }
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      if (contentLines >= MAX_DIFF_LINES) {
        diff.truncated = true;
        break;
      }
      current = { header: line, lines: [] };
      diff.hunks.push(current);
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[3], 10);
      continue;
    }
    if (!current || diff.conflicted) continue;
    if (line.startsWith("\\")) continue;
    let kind: GitDiffLine["kind"];
    if (line.startsWith("+")) kind = "add";
    else if (line.startsWith("-")) kind = "del";
    else if (line.startsWith(" ")) kind = "context";
    else continue; // 头部行（diff --git / index / --- / +++ 等）只出现在首个 hunk 之前

    const entry: GitDiffLine = {
      kind,
      text: line.slice(1),
      oldLine: kind === "add" ? null : oldLine,
      newLine: kind === "del" ? null : newLine,
    };
    if (kind !== "add") oldLine += 1;
    if (kind !== "del") newLine += 1;
    current.lines.push(entry);
    contentLines += 1;
    if (contentLines >= MAX_DIFF_LINES) {
      diff.truncated = true;
      break;
    }
  }

  if (diff.binary || diff.conflicted) diff.hunks = [];
  return diff;
}

/** 仓库相对路径 → 绝对路径，并拒绝越出仓库根（防 `..` / 绝对路径注入）。 */
function resolveRepoPath(repoRoot: string, relPath: string): string {
  const abs = path.resolve(repoRoot, relPath);
  const root = path.resolve(repoRoot);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new GitError(`非法路径：${relPath}`);
  }
  return abs;
}

/** 校验 tree OID 格式（hex），避免拼进 git 参数被当成路径/选项。 */
function assertTreeOid(treeOid: string): void {
  if (!/^[0-9a-f]{7,64}$/i.test(treeOid)) {
    throw new GitError("无效的快照标识");
  }
}

/**
 * 拍摄工作区完整快照（含未跟踪文件）：用临时 index 走
 * read-tree → add -A → write-tree，不改动真实 index / HEAD。
 * 返回 tree OID 与拍摄时的 HEAD；cwd 不是仓库时 treeOid=null。
 */
export async function createSnapshot(cwd: string): Promise<GitSnapshotResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) return { treeOid: null, headOid: null };

  const tmpIndex = path.join(
    os.tmpdir(),
    `pidesk-snap-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    let headOid: string | null = null;
    try {
      headOid = (await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"], { env })).trim() || null;
      await runGit(repoRoot, ["read-tree", "HEAD"], { env });
    } catch {
      // 空仓库（无 HEAD）：从空树开始再 add -A
      headOid = null;
      await runGit(repoRoot, ["read-tree", "--empty"], { env });
    }
    await runGit(repoRoot, ["add", "-A", "--"], { env });
    const treeOid = (await runGit(repoRoot, ["write-tree"], { env })).trim();
    return { treeOid: treeOid || null, headOid };
  } finally {
    await fs.promises.rm(tmpIndex, { force: true }).catch(() => undefined);
  }
}

/**
 * 将 paths 还原到快照时刻的文件内容。
 * - 快照中存在 → 从 tree blob 写回工作区（不动 index，保留用户已有暂存）
 * - 快照中不存在 → 视为 agent 本轮新建，删除文件
 * 空目录在删除后一并清理（尽力而为）。
 */
export async function rollbackToSnapshot(
  cwd: string,
  req: GitRollbackRequest,
): Promise<GitRollbackResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  assertTreeOid(req.treeOid);

  let restored = 0;
  let deleted = 0;
  // 去重：rename 新旧路径、同文件多层变更只处理一次
  const uniquePaths = [...new Set(req.paths.filter((p) => typeof p === "string" && p.length > 0))];

  for (const relPath of uniquePaths) {
    const abs = resolveRepoPath(repoRoot, relPath);
    let blob: Buffer | null = null;
    try {
      blob = await runGitBuffer(repoRoot, ["show", `${req.treeOid}:${relPath}`]);
    } catch {
      blob = null; // 快照中不存在
    }

    if (blob) {
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, blob);
      restored += 1;
      continue;
    }

    try {
      const stat = await fs.promises.lstat(abs);
      if (stat.isDirectory()) continue; // 不删目录本身
      await fs.promises.unlink(abs);
      deleted += 1;
      // 尽力清理空父目录（最多向上几层，不碰仓库根）
      let dir = path.dirname(abs);
      const root = path.resolve(repoRoot);
      for (let i = 0; i < 4 && dir.startsWith(root) && dir !== root; i += 1) {
        const entries = await fs.promises.readdir(dir).catch(() => null);
        if (!entries || entries.length > 0) break;
        await fs.promises.rmdir(dir).catch(() => undefined);
        dir = path.dirname(dir);
      }
    } catch {
      // 文件已不存在：无需删除
    }
  }

  return { restored, deleted };
}

/**
 * 对比工作区路径与指定快照：用于撤销前分类（还原 vs 删除新建）
 * 以及识别「轮末之后被手工修改」的冲突路径。
 */
export async function compareWorktreeToSnapshot(
  cwd: string,
  req: GitCompareSnapshotRequest,
): Promise<GitCompareSnapshotResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  assertTreeOid(req.treeOid);

  const uniquePaths = [...new Set(req.paths.filter((p) => typeof p === "string" && p.length > 0))];
  const items: GitCompareItem[] = [];

  for (const relPath of uniquePaths) {
    let inSnapshot = false;
    let snapshotOid: string | null = null;
    try {
      snapshotOid =
        (await runGit(repoRoot, ["rev-parse", `${req.treeOid}:${relPath}`])).trim() || null;
      inSnapshot = snapshotOid !== null;
    } catch {
      inSnapshot = false;
      snapshotOid = null;
    }

    let inWorktree = false;
    let worktreeOid: string | null = null;
    try {
      const abs = resolveRepoPath(repoRoot, relPath);
      const stat = await fs.promises.lstat(abs);
      if (stat.isFile()) {
        inWorktree = true;
        // --path：按与 snapshot `add` 相同的 clean filter 哈希，避免 CRLF 导致全量误报冲突
        worktreeOid =
          (await runGit(repoRoot, ["hash-object", "--path", relPath, "--", relPath])).trim() ||
          null;
      }
    } catch {
      inWorktree = false;
      worktreeOid = null;
    }

    let differs = false;
    if (inSnapshot && inWorktree) {
      differs = Boolean(snapshotOid && worktreeOid && snapshotOid !== worktreeOid);
      // 有一侧 hash 失败时保守视为不同，避免漏报冲突
      if (inSnapshot && inWorktree && (!snapshotOid || !worktreeOid)) differs = true;
    } else {
      differs = inSnapshot !== inWorktree;
    }

    items.push({ path: relPath, inSnapshot, inWorktree, differs });
  }

  return { items };
}

/** 列出本地分支 + 当前分支 + 未提交变更文件数（输入栏 Git 芯片）。 */
export async function getBranches(cwd: string): Promise<GitBranchesResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { repoRoot: null, current: null, branches: [], dirtyCount: 0 };
  }

  const [currentOut, branchesOut, statusOut] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
    runGit(repoRoot, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]),
    runGit(repoRoot, ["status", "--porcelain", "--untracked-files=all"]),
  ]);

  const current = currentOut.trim() || null;
  const branches: GitBranchInfo[] = branchesOut
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, current: name === current }));

  // 未提交变更：按路径去重（同一文件可同时 staged+unstaged）
  const dirtyPaths = new Set<string>();
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    // porcelain: XY<space>path  或  XY<space>old -> new
    const pathPart = line.slice(3).trim();
    if (!pathPart) continue;
    const newPath = pathPart.includes(" -> ")
      ? pathPart.slice(pathPart.indexOf(" -> ") + 4)
      : pathPart;
    dirtyPaths.add(newPath.replace(/^"|"$/g, ""));
  }

  return {
    repoRoot,
    current: current === "HEAD" ? null : current,
    branches,
    dirtyCount: dirtyPaths.size,
  };
}

/** 检出分支；create 为 true 时先创建（`git checkout -b`）。 */
export async function checkoutBranch(req: GitCheckoutRequest): Promise<GitBranchesResult> {
  const repoRoot = await resolveRepoRoot(req.cwd);
  if (!repoRoot) throw new GitError("当前目录不是 git 仓库");
  const name = req.branch.trim();
  if (!name) throw new GitError("分支名不能为空");
  // 分支名只允许安全字符，避免被当成选项
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("-")) {
    throw new GitError("分支名包含非法字符");
  }

  await runGit(repoRoot, req.create ? ["checkout", "-b", name] : ["checkout", name]);
  return getBranches(req.cwd);
}

/** log 字段分隔符：\x1f 字段、\x1e 提交，避免 subject/装饰名含空白时解析错位。 */
const LOG_FIELD_SEP = "\x1f";
const LOG_COMMIT_SEP = "\x1e";
const DEFAULT_LOG_MAX = 200;
const HARD_LOG_MAX = 1000;

/** 解析 %D 装饰：本地分支 / HEAD / tag；忽略 remote。 */
function parseDecorations(raw: string): { refs: string[]; isHead: boolean } {
  const refs: string[] = [];
  let isHead = false;
  if (!raw.trim()) return { refs, isHead };
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (name === "HEAD") {
      isHead = true;
      continue;
    }
    if (name.startsWith("HEAD -> ")) {
      isHead = true;
      const branch = name.slice("HEAD -> ".length).trim();
      if (branch && !branch.includes("/")) refs.push(branch);
      continue;
    }
    if (name.startsWith("tag: ")) continue;
    // origin/xxx 等远程引用不进图谱标签，避免噪音
    if (name.includes("/")) continue;
    refs.push(name);
  }
  return { refs, isHead };
}

/**
 * 读取提交图（只读 `git log --all`）：
 * 字段用 \x1f 分隔、提交用 \x1e，便于 subject 含空格/制表符时稳定解析。
 */
export async function getLog(req: GitLogRequest): Promise<GitLogResult> {
  const repoRoot = await resolveRepoRoot(req.cwd);
  if (!repoRoot) {
    return {
      repoRoot: null,
      commits: [],
      truncated: false,
      currentBranch: null,
    };
  }

  const maxCount = Math.min(HARD_LOG_MAX, Math.max(1, Math.floor(req.maxCount ?? DEFAULT_LOG_MAX)));

  // 空仓库：git log 失败或空输出
  let headOid: string | null = null;
  try {
    headOid = (await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"])).trim() || null;
  } catch {
    headOid = null;
  }
  if (!headOid) {
    return { repoRoot, commits: [], truncated: false, currentBranch: null };
  }

  const [logOut, branchOut] = await Promise.all([
    runGit(repoRoot, [
      "log",
      "--all",
      `--max-count=${maxCount + 1}`,
      "--date-order",
      `--pretty=format:%H${LOG_FIELD_SEP}%h${LOG_FIELD_SEP}%P${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%ae${LOG_FIELD_SEP}%at${LOG_FIELD_SEP}%s${LOG_FIELD_SEP}%D${LOG_COMMIT_SEP}`,
    ]),
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
  ]);

  const currentBranch = branchOut.trim();
  const currentBranchName = !currentBranch || currentBranch === "HEAD" ? null : currentBranch;

  const records = logOut
    .split(LOG_COMMIT_SEP)
    .map((r) => r.trim())
    .filter(Boolean);
  const truncated = records.length > maxCount;
  const commits: GitCommit[] = [];

  for (const record of records.slice(0, maxCount)) {
    const fields = record.split(LOG_FIELD_SEP);
    if (fields.length < 7) continue;
    const [
      oid,
      shortOid,
      parentsRaw,
      authorName,
      authorEmail,
      atRaw,
      subject,
      decorationsRaw = "",
    ] = fields;
    if (!oid) continue;
    const { refs, isHead } = parseDecorations(decorationsRaw ?? "");
    const parentOids = (parentsRaw ?? "").split(/\s+/).filter(Boolean);
    commits.push({
      oid,
      shortOid: shortOid || oid.slice(0, 7),
      subject: subject ?? "",
      authorName: authorName ?? "",
      authorEmail: authorEmail ?? "",
      // 登录 + GitHub remote 时在下方统一补 avatarDataUrl；否则 null → 首字母
      avatarDataUrl: null,
      authorTime: Number.parseInt(atRaw ?? "0", 10) || 0,
      parentOids,
      refs,
      isHead,
      isCurrentBranchTip: isHead && !!currentBranchName,
    });
  }

  await enrichAuthorAvatars(repoRoot, commits);
  return { repoRoot, commits, truncated, currentBranch: currentBranchName };
}

/** 找到可解析为 GitHub 的 remote（优先 origin）。 */
async function findGitHubRepo(repoRoot: string): Promise<{ owner: string; repo: string } | null> {
  let remotes: string[] = [];
  try {
    remotes = (await runGit(repoRoot, ["remote"]))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  const ordered = remotes.includes("origin")
    ? ["origin", ...remotes.filter((r) => r !== "origin")]
    : remotes;
  for (const name of ordered) {
    let url = "";
    try {
      url = (await runGit(repoRoot, ["remote", "get-url", name])).trim();
    } catch {
      continue;
    }
    const parsed = parseGitHubRepo(url);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * 登录后按 GitHub remote 解析作者头像写入 commits。
 * 未登录 / 非 GitHub remote / 网络失败：保持 null，渲染层首字母兜底。
 */
async function enrichAuthorAvatars(repoRoot: string, commits: GitCommit[]): Promise<void> {
  const token = readToken();
  if (!token || commits.length === 0) return;
  const repo = await findGitHubRepo(repoRoot);
  if (!repo) return;
  const emails = [...new Set(commits.map((c) => c.authorEmail).filter(Boolean))];
  if (emails.length === 0) return;
  try {
    const avatars = await fetchGitHubAuthorAvatars({
      token,
      owner: repo.owner,
      repo: repo.repo,
      emails,
    });
    if (avatars.size === 0) return;
    for (const commit of commits) {
      const key = commit.authorEmail.trim().toLowerCase();
      const dataUrl = key ? avatars.get(key) : undefined;
      if (dataUrl) commit.avatarDataUrl = dataUrl;
    }
  } catch {
    // 头像失败不影响图谱
  }
}

// ---------------------------------------------------------------------------
// Git 写操作（docs/design 30 §2.1）：暂存 / 取消暂存 / 丢弃 / 提交 / 推送
// 一律复用 runGit（execFile 参数数组，无 shell 拼接）+ resolveRepoRoot + resolveRepoPath。
// 推送遵循「不猜」：多 remote 且无 upstream 时直接报错，不臆测目标。
// ---------------------------------------------------------------------------

/** 去重、剔空并校验每个仓库相对路径不越界；返回原始相对路径（git 以 repoRoot 为 cwd 解析）。 */
function normalizePathspecs(repoRoot: string, paths: string[] | undefined): string[] {
  const unique = [...new Set((paths ?? []).filter((p) => typeof p === "string" && p.length > 0))];
  for (const relPath of unique) resolveRepoPath(repoRoot, relPath);
  return unique;
}

/** 校验远程/分支名只含安全字符，避免被 git 当成选项。 */
function assertSafeRef(name: string, label: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("-")) {
    throw new GitError(`${label}包含非法字符`);
  }
}

/** 读取 HEAD 下全部文件路径（用于丢弃时分类 tracked / untracked）；空仓库返回 null。 */
async function listHeadPaths(repoRoot: string): Promise<Set<string> | null> {
  if (!(await resolveHeadOid(repoRoot))) return null;
  const out = await runGit(repoRoot, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  return new Set(out.split("\0").filter(Boolean));
}

/** 暂存指定路径（git add）。 */
export async function stagePaths(cwd: string, req: GitStageRequest): Promise<GitWriteResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  const paths = normalizePathspecs(repoRoot, req.paths);
  if (paths.length === 0) throw new GitError("没有需要暂存的路径");
  await runGit(repoRoot, ["add", "--", ...paths]);
  return { affected: paths.length };
}

/** 取消暂存指定路径；空仓库（无 HEAD）回退到 `git rm --cached`。 */
export async function unstagePaths(cwd: string, req: GitStageRequest): Promise<GitWriteResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  const paths = normalizePathspecs(repoRoot, req.paths);
  if (paths.length === 0) throw new GitError("没有需要取消暂存的路径");
  if (await resolveHeadOid(repoRoot)) {
    await runGit(repoRoot, ["reset", "-q", "HEAD", "--", ...paths]);
  } else {
    await runGit(repoRoot, ["rm", "--cached", "-r", "-q", "--", ...paths]);
  }
  return { affected: paths.length };
}

/**
 * 丢弃指定路径的本地改动（破坏性）：
 * - HEAD 中存在 → `git checkout HEAD -- <path>` 同时还原 index 与工作区；
 * - HEAD 中不存在（暂存的新文件 / 未跟踪）→ 先取消暂存再 `git clean -fd` 删除。
 */
export async function discardPaths(cwd: string, req: GitDiscardRequest): Promise<GitDiscardResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  const paths = normalizePathspecs(repoRoot, req.paths);
  if (paths.length === 0) throw new GitError("没有需要丢弃的路径");

  const headPaths = await listHeadPaths(repoRoot);
  const tracked: string[] = [];
  const other: string[] = [];
  for (const relPath of paths) {
    if (headPaths?.has(relPath)) tracked.push(relPath);
    else other.push(relPath);
  }

  let restored = 0;
  let removed = 0;
  if (tracked.length > 0) {
    await runGit(repoRoot, ["checkout", "HEAD", "--", ...tracked]);
    restored = tracked.length;
  }
  if (other.length > 0) {
    if (headPaths) {
      await runGit(repoRoot, ["reset", "-q", "HEAD", "--", ...other]).catch(() => undefined);
    }
    await runGit(repoRoot, ["clean", "-fd", "--", ...other]);
    removed = other.length;
  }
  return { restored, removed };
}

/** 提交已暂存改动（手写提交信息）；无暂存内容时 git 报错原样透出。 */
export async function commitChanges(cwd: string, req: GitCommitRequest): Promise<GitCommitResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  const message = req.message.replace(/\r\n/g, "\n").trim();
  if (!message) throw new GitError("提交信息不能为空");
  await runGit(repoRoot, ["commit", "-m", message]);
  const oid = (await runGit(repoRoot, ["rev-parse", "HEAD"])).trim();
  if (!oid) throw new GitError("提交后未能读取 HEAD");
  return {
    oid,
    shortOid: oid.slice(0, 7),
    subject: message.split("\n")[0] ?? "",
  };
}

/**
 * 计算推送计划：解析当前分支、upstream / remote、领先提交数。
 * 「不猜」策略：游离 HEAD、无 remote、或多 remote 且无 upstream 时直接抛可展示错误。
 */
export async function getPushPlan(cwd: string): Promise<GitPushPlan> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");

  const branch = (await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!branch || branch === "HEAD") {
    throw new GitError("当前处于游离 HEAD 状态，无法推送");
  }

  let upstream: string | null = null;
  try {
    upstream =
      (
        await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
      ).trim() || null;
  } catch {
    upstream = null;
  }

  let remote: string | null = null;
  let remoteBranch = branch;
  if (upstream?.includes("/")) {
    remote = upstream.slice(0, upstream.indexOf("/"));
    remoteBranch = upstream.slice(upstream.indexOf("/") + 1);
  } else {
    const remotes = (await runGit(repoRoot, ["remote"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (remotes.length === 0) throw new GitError("没有配置远程仓库（remote）");
    if (remotes.length > 1) {
      throw new GitError("存在多个远程仓库且当前分支无 upstream，请先指定推送目标");
    }
    remote = remotes[0] ?? null;
  }
  if (!remote) throw new GitError("无法确定推送目标远程仓库");

  let ahead = 0;
  if (upstream) {
    const countOut = (await runGit(repoRoot, ["rev-list", "--count", `${upstream}..HEAD`])).trim();
    ahead = Number.parseInt(countOut, 10) || 0;
  } else {
    try {
      const countOut = (
        await runGit(repoRoot, ["rev-list", "--count", `${remote}/${remoteBranch}..HEAD`])
      ).trim();
      ahead = Number.parseInt(countOut, 10) || 0;
    } catch {
      ahead = 0;
    }
  }

  return {
    remote,
    branch,
    remoteBranch,
    ahead,
    hasUpstream: Boolean(upstream),
  };
}

/** 推送当前分支到远程；remote / branch 由调用方显式给出（来自 getPushPlan）。 */
export async function pushBranch(cwd: string, req: GitPushRequest): Promise<GitPushResult> {
  const repoRoot = await resolveRepoRoot(cwd);
  if (!repoRoot) throw new GitError("当前目录不是 Git 仓库");
  const remote = req.remote.trim();
  const branch = req.branch.trim();
  if (!remote || !branch) throw new GitError("推送目标不完整");
  assertSafeRef(remote, "远程名");
  assertSafeRef(branch, "分支名");
  const args = ["push"];
  if (req.setUpstream) args.push("--set-upstream");
  args.push(remote, branch);
  await runGit(repoRoot, args);
  return { remote, branch };
}
