import type {
  GitBranchesResult,
  GitCheckoutRequest,
  GitCommitRequest,
  GitCommitResult,
  GitCompareSnapshotRequest,
  GitCompareSnapshotResult,
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
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** Git 审查数据服务（主进程 git 模块）：仓库状态总览 + 单文件 diff + 快照回滚 + 分支 + 提交图。 */
export const gitService = {
  status(cwd: string): Promise<GitStatusResult> {
    const api = pideskApi();
    if (!api) return Promise.resolve({ repoRoot: null, changes: [], headOid: null });
    return unwrap(api.git.status(cwd));
  },
  diff(req: GitDiffRequest): Promise<GitFileDiff> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.diff(req));
  },
  /** agent 一轮开始前拍摄工作区快照（含未跟踪）。 */
  snapshot(cwd: string): Promise<GitSnapshotResult> {
    const api = pideskApi();
    if (!api) return Promise.resolve({ treeOid: null, headOid: null });
    return unwrap(api.git.snapshot(cwd));
  },
  /** 将 paths 还原到快照时刻；快照中不存在的会被删除。 */
  rollback(req: GitRollbackRequest): Promise<GitRollbackResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.rollback(req));
  },
  /** 对比工作区路径与指定快照（冲突检测 / 还原-删除分类）。 */
  compareSnapshot(req: GitCompareSnapshotRequest): Promise<GitCompareSnapshotResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.compareSnapshot(req));
  },
  /** 列出本地分支 + 当前分支 + 未提交变更数（输入栏 Git 芯片）。 */
  branches(cwd: string): Promise<GitBranchesResult> {
    const api = pideskApi();
    if (!api) {
      return Promise.resolve({
        repoRoot: null,
        current: null,
        branches: [],
        dirtyCount: 0,
      });
    }
    return unwrap(api.git.branches(cwd));
  },
  /** 检出分支；create 为 true 时先创建。 */
  checkout(req: GitCheckoutRequest): Promise<GitBranchesResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.checkout(req));
  },
  /** 读取提交图（只读 log）。 */
  log(req: GitLogRequest): Promise<GitLogResult> {
    const api = pideskApi();
    if (!api)
      return Promise.resolve({
        repoRoot: null,
        commits: [],
        truncated: false,
        currentBranch: null,
      });
    return unwrap(api.git.log(req));
  },
  /** 暂存指定路径。 */
  stage(req: GitStageRequest): Promise<GitWriteResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.stage(req));
  },
  /** 取消暂存指定路径。 */
  unstage(req: GitStageRequest): Promise<GitWriteResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.unstage(req));
  },
  /** 丢弃指定路径的本地改动（破坏性）。 */
  discard(req: GitDiscardRequest): Promise<GitDiscardResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.discard(req));
  },
  /** 提交已暂存改动（手写提交信息）。 */
  commit(req: GitCommitRequest): Promise<GitCommitResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.commit(req));
  },
  /** 读取推送计划（供二次确认复述 remote / branch / 领先提交数）。 */
  pushPlan(cwd: string): Promise<GitPushPlan> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.pushPlan(cwd));
  },
  /** 推送当前分支到远程。 */
  push(req: GitPushRequest): Promise<GitPushResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.git.push(req));
  },
};
