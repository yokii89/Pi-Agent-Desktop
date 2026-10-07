import { ipcMain } from "electron";
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
  IpcResult,
} from "../../shared/ipc";
import { GIT_IPC } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import {
  checkoutBranch,
  commitChanges,
  compareWorktreeToSnapshot,
  createSnapshot,
  discardPaths,
  getBranches,
  getChanges,
  getFileDiff,
  getLog,
  getPushPlan,
  pushBranch,
  rollbackToSnapshot,
  stagePaths,
  unstagePaths,
} from "./gitService";

/** 校验 cwd + paths 数组，返回剔除非字符串后的路径列表。 */
function normalizePathsRequest(req: { cwd?: unknown; paths?: unknown }): {
  cwd: string;
  paths: string[];
} {
  if (typeof req?.cwd !== "string" || !req.cwd || !Array.isArray(req?.paths)) {
    throw new Error("参数不完整");
  }
  return {
    cwd: req.cwd,
    paths: req.paths.filter((p): p is string => typeof p === "string"),
  };
}

/** 校验渲染层传入的 diff 请求，防止缺参导致的模糊报错。 */
function normalizeDiffRequest(req: GitDiffRequest): GitDiffRequest {
  if (typeof req?.cwd !== "string" || typeof req?.path !== "string") {
    throw new Error("参数不完整");
  }
  return {
    cwd: req.cwd,
    path: req.path,
    oldPath: typeof req.oldPath === "string" && req.oldPath ? req.oldPath : null,
    layer: req.layer,
  };
}

/** 注册 Git 审查 IPC（docs/design/04）。 */
export function registerGitIpc(): void {
  ipcMain.handle(
    GIT_IPC.status,
    (_event, req: { cwd: string }): Promise<IpcResult<GitStatusResult>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd) throw new Error("参数不完整");
        return getChanges(req.cwd);
      }),
  );

  ipcMain.handle(
    GIT_IPC.diff,
    (_event, req: GitDiffRequest): Promise<IpcResult<GitFileDiff>> =>
      envelopeAsync(async () => getFileDiff(req.cwd, normalizeDiffRequest(req))),
  );

  ipcMain.handle(
    GIT_IPC.snapshot,
    (_event, req: { cwd: string }): Promise<IpcResult<GitSnapshotResult>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd) throw new Error("参数不完整");
        return createSnapshot(req.cwd);
      }),
  );

  ipcMain.handle(
    GIT_IPC.rollback,
    (_event, req: GitRollbackRequest): Promise<IpcResult<GitRollbackResult>> =>
      envelopeAsync(async () => {
        if (
          typeof req?.cwd !== "string" ||
          !req.cwd ||
          typeof req?.treeOid !== "string" ||
          !req.treeOid ||
          !Array.isArray(req?.paths)
        ) {
          throw new Error("参数不完整");
        }
        return rollbackToSnapshot(req.cwd, {
          cwd: req.cwd,
          treeOid: req.treeOid,
          paths: req.paths.filter((p): p is string => typeof p === "string"),
        });
      }),
  );

  ipcMain.handle(
    GIT_IPC.compareSnapshot,
    (_event, req: GitCompareSnapshotRequest): Promise<IpcResult<GitCompareSnapshotResult>> =>
      envelopeAsync(async () => {
        if (
          typeof req?.cwd !== "string" ||
          !req.cwd ||
          typeof req?.treeOid !== "string" ||
          !req.treeOid ||
          !Array.isArray(req?.paths)
        ) {
          throw new Error("参数不完整");
        }
        return compareWorktreeToSnapshot(req.cwd, {
          cwd: req.cwd,
          treeOid: req.treeOid,
          paths: req.paths.filter((p): p is string => typeof p === "string"),
        });
      }),
  );

  ipcMain.handle(
    GIT_IPC.branches,
    (_event, req: { cwd: string }): Promise<IpcResult<GitBranchesResult>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd) throw new Error("参数不完整");
        return getBranches(req.cwd);
      }),
  );

  ipcMain.handle(
    GIT_IPC.checkout,
    (_event, req: GitCheckoutRequest): Promise<IpcResult<GitBranchesResult>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd || typeof req?.branch !== "string") {
          throw new Error("参数不完整");
        }
        return checkoutBranch({
          cwd: req.cwd,
          branch: req.branch,
          create: req.create === true,
        });
      }),
  );

  ipcMain.handle(
    GIT_IPC.log,
    (_event, req: GitLogRequest): Promise<IpcResult<GitLogResult>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd) throw new Error("参数不完整");
        return getLog({
          cwd: req.cwd,
          maxCount:
            typeof req.maxCount === "number" && Number.isFinite(req.maxCount)
              ? req.maxCount
              : undefined,
        });
      }),
  );

  ipcMain.handle(
    GIT_IPC.stage,
    (_event, req: GitStageRequest): Promise<IpcResult<GitWriteResult>> =>
      envelopeAsync(async () => stagePaths(req.cwd, normalizePathsRequest(req))),
  );

  ipcMain.handle(
    GIT_IPC.unstage,
    (_event, req: GitStageRequest): Promise<IpcResult<GitWriteResult>> =>
      envelopeAsync(async () => unstagePaths(req.cwd, normalizePathsRequest(req))),
  );

  ipcMain.handle(
    GIT_IPC.discard,
    (_event, req: GitDiscardRequest): Promise<IpcResult<GitDiscardResult>> =>
      envelopeAsync(async () => discardPaths(req.cwd, normalizePathsRequest(req))),
  );

  ipcMain.handle(
    GIT_IPC.commit,
    (_event, req: GitCommitRequest): Promise<IpcResult<GitCommitResult>> =>
      envelopeAsync(async () => {
        if (
          typeof req?.cwd !== "string" ||
          !req.cwd ||
          typeof req?.message !== "string" ||
          !req.message.trim()
        ) {
          throw new Error("参数不完整");
        }
        return commitChanges(req.cwd, { cwd: req.cwd, message: req.message });
      }),
  );

  ipcMain.handle(
    GIT_IPC.pushPlan,
    (_event, req: { cwd: string }): Promise<IpcResult<GitPushPlan>> =>
      envelopeAsync(async () => {
        if (typeof req?.cwd !== "string" || !req.cwd) throw new Error("参数不完整");
        return getPushPlan(req.cwd);
      }),
  );

  ipcMain.handle(
    GIT_IPC.push,
    (_event, req: GitPushRequest): Promise<IpcResult<GitPushResult>> =>
      envelopeAsync(async () => {
        if (
          typeof req?.cwd !== "string" ||
          !req.cwd ||
          typeof req?.remote !== "string" ||
          !req.remote ||
          typeof req?.branch !== "string" ||
          !req.branch
        ) {
          throw new Error("参数不完整");
        }
        return pushBranch(req.cwd, {
          cwd: req.cwd,
          remote: req.remote,
          branch: req.branch,
          setUpstream: req.setUpstream === true,
        });
      }),
  );
}
