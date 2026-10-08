import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GitChange,
  GitCommitResult,
  GitDiscardResult,
  GitPushPlan,
  GitPushResult,
} from "../../shared/ipc";
import { gitService } from "../services/gitService";
import { sessionService } from "../services/sessionService";
import {
  emptyRollbackInspect,
  type RollbackBlockReason,
  type RollbackInspect,
  rollbackTargetPaths,
} from "../utils/rollbackLastRound";
import { useSessionMeta } from "./sessionStore";

/** 审查面板状态机（docs/design/04 §17）。 */
export type ReviewPhase =
  | "noWorkspace" // 没有项目 / 会话工作目录
  | "loading" // 首次读取
  | "ready" // 仓库已读取（changes 可能为空 = 工作区干净）
  | "notRepo" // 目录不是 git 仓库
  | "error"; // git 命令失败

/**
 * 变更筛选模式（参照 docs/审查页面ui 的顶部下拉）。
 * - unstaged：未暂存 + 未跟踪（工作区相对暂存区）
 * - staged：已暂存（暂存区相对 HEAD）
 * - all：全部工作区变更
 * - lastRound：最近一轮 Agent 任务产生的变更（与任务开始前快照对比）
 */
export type ReviewFilterMode = "unstaged" | "staged" | "all" | "lastRound";

/** 审查面板二级视图：变更列表 / 提交图谱。 */
export type ReviewView = "changes" | "graph";

/** agent 一轮结束后延迟刷新，合并 pi 连续写盘产生的多次触发。 */
const AGENT_REFRESH_DELAY_MS = 800;
/** Review tab 重新可见时的数据保鲜期，过期才后台重读（避免切 Tab 反复执行 git）。 */
const STALE_MS = 15000;

/** 变更条目的稳定标识：同一路径可在 staged/unstaged 两层各出现一次。 */
export function changeKey(change: Pick<GitChange, "layer" | "path">): string {
  return `${change.layer}|${change.path}`;
}

/** 从变更条目提取去重路径；includeOld 时一并纳入 rename/copy 的原路径（暂存删除 / 撤销重命名需要）。 */
function changesToPaths(changes: GitChange[], includeOld: boolean): string[] {
  const set = new Set<string>();
  for (const change of changes) {
    if (change.path) set.add(change.path);
    if (includeOld && change.oldPath) set.add(change.oldPath);
  }
  return [...set];
}

/** 变更内容指纹：用于识别「上一轮」中新增或统计变化的条目。 */
function changeFingerprint(change: GitChange): string {
  return [
    change.status,
    change.oldPath ?? "",
    String(change.additions ?? "?"),
    String(change.deletions ?? "?"),
  ].join("|");
}

interface ReviewSummary {
  /** 去重后的变更文件数。 */
  files: number;
  additions: number;
  deletions: number;
}

interface ReviewStoreValue {
  /** 会话工作目录（审查绑定的锚点）。 */
  cwd: string | null;
  phase: ReviewPhase;
  /** 已有数据时的后台刷新（区别于首次 loading）。 */
  refreshing: boolean;
  error: string | null;
  repoRoot: string | null;
  changes: GitChange[];
  staged: GitChange[];
  unstaged: GitChange[];
  untracked: GitChange[];
  /** 最近一轮 Agent 任务前后的变更差集。 */
  lastRound: GitChange[];
  summary: ReviewSummary;
  lastUpdated: number | null;
  /** 每次成功刷新递增：diff 缓存失效依据。 */
  changesVersion: number;
  /** 当前筛选模式。 */
  filterMode: ReviewFilterMode;
  setFilterMode: (mode: ReviewFilterMode) => void;
  /** 当前审查视图（变更 / 图谱）。 */
  reviewView: ReviewView;
  setReviewView: (view: ReviewView) => void;
  /** 提交图谱的手动刷新计数（刷新按钮递增；停靠/浮窗两种宿主共用）。 */
  graphRefreshSeq: number;
  bumpGraphRefresh: () => void;
  /** 按当前筛选模式得到的文件列表（已排序）。 */
  visibleChanges: GitChange[];
  selectedKey: string | null;
  selectedChange: GitChange | null;
  selectChange: (change: GitChange) => void;
  clearSelection: () => void;
  refresh: () => Promise<void>;
  /** Review 面板可见时调用：数据过期才刷新，保证切 Tab 不重复执行 git。 */
  refreshIfStale: () => void;
  /** 是否具备可回滚的上一轮快照且列表非空。 */
  canRollback: boolean;
  /** 不可撤销时的原因（ready = 可撤销）。供禁用 tooltip / 空态文案。 */
  rollbackBlockReason: RollbackBlockReason;
  /** 回滚进行中。 */
  rollingBack: boolean;
  /**
   * 将上一轮 Agent 触碰过的文件还原到任务开始前的快照：
   * 快照中存在的写回内容，快照中不存在的（本轮新建）删除。
   */
  rollbackLastRound: () => Promise<{
    restored: number;
    deleted: number;
  } | null>;
  /**
   * 撤销确认前核对：还原/删除分类 + 轮末之后手工修改的冲突路径。
   * 供 FileEditsSummary 与审查浮窗（ReviewWindow/ChangesPane）共用确认框。
   */
  inspectRollback: () => Promise<RollbackInspect>;
  /**
   * 回滚确认弹窗（状态提升：全局快捷键与两处按钮触发同一确认流）。
   * requestRollbackPrompt 打开弹窗并异步核对；confirm 执行回滚并收起。
   */
  rollbackPromptOpen: boolean;
  rollbackPromptInspect: RollbackInspect | null;
  requestRollbackPrompt: () => void;
  dismissRollbackPrompt: () => void;
  confirmRollbackPrompt: () => Promise<{ restored: number; deleted: number } | null>;
  /** 写操作进行中（暂存/取消暂存/丢弃/提交/推送）。 */
  writing: boolean;
  /** 暂存指定变更（含 rename 原路径）。 */
  stageChanges: (targets: GitChange[]) => Promise<void>;
  /** 取消暂存指定变更。 */
  unstageChanges: (targets: GitChange[]) => Promise<void>;
  /** 丢弃指定变更的本地改动（破坏性）；返回还原/删除计数。 */
  discardChanges: (targets: GitChange[]) => Promise<GitDiscardResult>;
  /** 提交已暂存改动（手写提交信息）。 */
  commit: (message: string) => Promise<GitCommitResult>;
  /** 读取推送计划（供二次确认复述）；不改动仓库。 */
  fetchPushPlan: () => Promise<GitPushPlan>;
  /** 按给定计划推送（调用方已完成二次确认）。 */
  push: (plan: GitPushPlan) => Promise<GitPushResult>;
}

const ReviewStoreContext = createContext<ReviewStoreValue | null>(null);

/** 审查状态模型：Git Changes → Review Model → UI（docs/design/04 §23）。 */
export function ReviewProvider({ children }: { children: ReactNode }) {
  const { sessionWorkingDir, activeSessionId } = useSessionMeta();
  const [phase, setPhase] = useState<ReviewPhase>("noWorkspace");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [lastRound, setLastRound] = useState<GitChange[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [changesVersion, setChangesVersion] = useState(0);
  const [filterMode, setFilterMode] = useState<ReviewFilterMode>("unstaged");
  const [reviewView, setReviewView] = useState<ReviewView>("changes");
  const [graphRefreshSeq, setGraphRefreshSeq] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** agent 一轮开始前的工作区快照 tree OID；null = 本轮无法回滚。 */
  const [preRoundTreeOid, setPreRoundTreeOid] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackPromptOpen, setRollbackPromptOpen] = useState(false);
  const [rollbackPromptInspect, setRollbackPromptInspect] = useState<RollbackInspect | null>(null);
  /** 弹窗打开时归属的会话：确认前校验，防止弹窗打开期间切换会话后回滚错仓库。 */
  const rollbackPromptSessionIdRef = useRef<string | null>(null);
  /** Git 写操作进行中（暂存/取消暂存/丢弃/提交/推送）。 */
  const [writing, setWriting] = useState(false);
  /** clearRollbackState 记录的原因；canRollback 时覆盖为 ready。 */
  const [storedBlockReason, setStoredBlockReason] = useState<RollbackBlockReason>("noSession");

  const cwdRef = useRef<string | null>(sessionWorkingDir);
  cwdRef.current = sessionWorkingDir;
  const changesRef = useRef<GitChange[]>(changes);
  changesRef.current = changes;
  /** agent 一轮开始前的变更指纹基线；refresh 后与新列表求差得到 lastRound。 */
  const lastRoundBaselineRef = useRef<Map<string, string>>(new Map());
  /** 最近一次 status 读到的 HEAD（agent_start 时同步锚定用）。 */
  const lastHeadOidRef = useRef<string | null>(null);
  /** 本轮是否已锚定（agent_start 后、清理前）。 */
  const roundActiveRef = useRef(false);
  /** 锚定时的 HEAD；与当前 HEAD 不同说明已提交。 */
  const roundHeadRef = useRef<string | null>(null);
  /** 本轮 agent 结束时的工作区快照；用于撤销前冲突检测（轮末后手工修改）。 */
  const roundEndTreeOidRef = useRef<string | null>(null);
  const roundEndSeqRef = useRef(0);
  /** 在途快照序号：换目录/新轮次后丢弃旧结果。 */
  const snapshotSeqRef = useRef(0);
  const lastUpdatedRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  /** 作废「上一轮」回滚能力：丢掉 tree OID / HEAD 锚点 / 差集 / 指纹基线 / 轮末快照。 */
  const clearRollbackState = useCallback((reason: RollbackBlockReason = "empty"): void => {
    roundActiveRef.current = false;
    roundHeadRef.current = null;
    roundEndTreeOidRef.current = null;
    setPreRoundTreeOid(null);
    setLastRound([]);
    lastRoundBaselineRef.current = new Map();
    setStoredBlockReason(reason);
  }, []);

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof gitService.status>>) => {
      setLastUpdated(Date.now());
      lastUpdatedRef.current = Date.now();
      lastHeadOidRef.current = result.headOid;
      setRefreshing(false);
      setError(null);
      if (result.repoRoot === null) {
        setPhase("notRepo");
        setRepoRoot(null);
        setChanges([]);
        setSelectedKey(null);
        clearRollbackState("notRepo");
        return;
      }
      setPhase("ready");
      setRepoRoot(result.repoRoot);
      setChanges(result.changes);
      setChangesVersion((v) => v + 1);

      // 用户（或 agent）已提交：HEAD 相对本轮锚点变了 → 回滚语义失效，立刻清理
      if (roundActiveRef.current && result.headOid !== roundHeadRef.current) {
        clearRollbackState("committed");
      } else if (roundActiveRef.current) {
        // 空仓库/干净工作区基线为空时，当前全部变更都算本轮（不能用 baseline.size 跳过）
        const baseline = lastRoundBaselineRef.current;
        const round = result.changes.filter(
          (c) => baseline.get(changeKey(c)) !== changeFingerprint(c),
        );
        setLastRound(round);
      }

      // 刷新后原选中项可能已无变更（如文件被提交），使其失效
      setSelectedKey((prev) =>
        prev && result.changes.some((c) => changeKey(c) === prev) ? prev : null,
      );
    },
    [clearRollbackState],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const cwd = cwdRef.current;
    if (!cwd) return;
    const seq = ++seqRef.current;
    setRefreshing(true);
    setPhase((prev) =>
      prev === "ready" || prev === "notRepo" || prev === "error" ? prev : "loading",
    );
    try {
      const result = await gitService.status(cwd);
      if (seqRef.current !== seq) return;
      applyResult(result);
    } catch (err) {
      if (seqRef.current !== seq) return;
      setPhase("error");
      setRefreshing(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [applyResult]);

  const scheduleRefresh = useCallback(
    (delayMs: number): void => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void refresh();
      }, delayMs);
    },
    [refresh],
  );

  // 工作目录变化（切换项目 / 恢复其他目录的会话）→ 立即重读
  useEffect(() => {
    if (!sessionWorkingDir) {
      seqRef.current += 1; // 使在途请求失效
      snapshotSeqRef.current += 1;
      roundEndSeqRef.current += 1;
      setPhase("noWorkspace");
      setRepoRoot(null);
      setChanges([]);
      setSelectedKey(null);
      setError(null);
      setRefreshing(false);
      clearRollbackState("noSession");
      return;
    }
    clearRollbackState("noSnapshot");
    void refresh();
  }, [sessionWorkingDir, refresh, clearRollbackState]);

  // agent 一轮：开始时拍快照（供回滚），结束时防抖刷新 + 锁定轮末快照（冲突检测）
  // 仅 active 会话的事件驱动回滚域（多会话：后台 agent 不改变 A 的 canRollback）
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  useEffect(() => {
    return sessionService.subscribe((message) => {
      if (message.type !== "event") return;
      if (
        message.sessionId &&
        activeSessionIdRef.current &&
        message.sessionId !== activeSessionIdRef.current
      ) {
        return;
      }
      const event = message.payload;
      const { type } = event;
      if (type === "agent_start") {
        const cwd = cwdRef.current;
        if (!cwd) return;
        const seq = ++snapshotSeqRef.current;
        // 同步锚定本轮 HEAD（status 最近一次读到的），避免快照未完成时被误判为「已提交」
        roundActiveRef.current = true;
        roundHeadRef.current = lastHeadOidRef.current;
        roundEndTreeOidRef.current = null;
        setPreRoundTreeOid(null);
        setLastRound([]);
        setStoredBlockReason("noSnapshot");
        lastRoundBaselineRef.current = new Map(
          changesRef.current.map((c) => [changeKey(c), changeFingerprint(c)]),
        );
        void gitService.snapshot(cwd).then((result) => {
          if (snapshotSeqRef.current !== seq) return;
          setPreRoundTreeOid(result.treeOid);
          // 尚未 refresh 过时 lastHead 可能为空，用快照读到的 HEAD 补锚
          if (roundActiveRef.current && lastHeadOidRef.current === null && result.headOid) {
            roundHeadRef.current = result.headOid;
          }
        });
        return;
      }
      if (type === "agent_end" || type === "agent_settled") {
        // willRetry 中间事件：仍属同一轮，不锁定轮末快照
        const isRetryContinue = type === "agent_end" && event.willRetry === true;
        const cwd = cwdRef.current;
        if (!isRetryContinue && cwd && roundActiveRef.current && !roundEndTreeOidRef.current) {
          const endSeq = ++roundEndSeqRef.current;
          void gitService.snapshot(cwd).then((result) => {
            if (roundEndSeqRef.current !== endSeq) return;
            if (!roundActiveRef.current) return;
            if (!result.treeOid) return;
            // 轮内/轮末已提交则不作冲突基线
            if (
              result.headOid !== null &&
              roundHeadRef.current !== null &&
              result.headOid !== roundHeadRef.current
            ) {
              return;
            }
            roundEndTreeOidRef.current = result.treeOid;
          });
        }
        // store 仍是任务前状态；refresh 后与指纹基线求差得到 lastRound
        scheduleRefresh(AGENT_REFRESH_DELAY_MS);
      }
    });
  }, [scheduleRefresh]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const refreshIfStale = useCallback((): void => {
    if (!cwdRef.current) return;
    const last = lastUpdatedRef.current;
    if (last === null || Date.now() - last > STALE_MS) scheduleRefresh(0);
  }, [scheduleRefresh]);

  const selectChange = useCallback((change: GitChange): void => {
    setSelectedKey(changeKey(change));
  }, []);

  const clearSelection = useCallback((): void => {
    setSelectedKey(null);
  }, []);

  const bumpGraphRefresh = useCallback((): void => {
    setGraphRefreshSeq((n) => n + 1);
  }, []);

  // --- Git 写操作（docs/design 30 §2.1）：成功后统一 refresh，失败向调用方抛出供 toast ---
  const stageChanges = useCallback(
    async (targets: GitChange[]): Promise<void> => {
      const cwd = cwdRef.current;
      if (!cwd) throw new Error("没有可用的工作目录");
      const paths = changesToPaths(targets, true);
      if (paths.length === 0) return;
      setWriting(true);
      try {
        await gitService.stage({ cwd, paths });
        await refresh();
      } finally {
        setWriting(false);
      }
    },
    [refresh],
  );

  const unstageChanges = useCallback(
    async (targets: GitChange[]): Promise<void> => {
      const cwd = cwdRef.current;
      if (!cwd) throw new Error("没有可用的工作目录");
      const paths = changesToPaths(targets, true);
      if (paths.length === 0) return;
      setWriting(true);
      try {
        await gitService.unstage({ cwd, paths });
        await refresh();
      } finally {
        setWriting(false);
      }
    },
    [refresh],
  );

  const discardChanges = useCallback(
    async (targets: GitChange[]): Promise<GitDiscardResult> => {
      const cwd = cwdRef.current;
      if (!cwd) throw new Error("没有可用的工作目录");
      const paths = changesToPaths(targets, true);
      if (paths.length === 0) throw new Error("没有需要丢弃的路径");
      setWriting(true);
      try {
        const result = await gitService.discard({ cwd, paths });
        setSelectedKey(null);
        await refresh();
        return result;
      } finally {
        setWriting(false);
      }
    },
    [refresh],
  );

  const commit = useCallback(
    async (message: string): Promise<GitCommitResult> => {
      const cwd = cwdRef.current;
      if (!cwd) throw new Error("没有可用的工作目录");
      setWriting(true);
      try {
        const result = await gitService.commit({ cwd, message });
        // 提交后 HEAD 变了，“上一轮”回滚语义失效（applyResult 会自动清理），清选中并重读
        setSelectedKey(null);
        await refresh();
        return result;
      } finally {
        setWriting(false);
      }
    },
    [refresh],
  );

  const fetchPushPlan = useCallback(async (): Promise<GitPushPlan> => {
    const cwd = cwdRef.current;
    if (!cwd) throw new Error("没有可用的工作目录");
    return gitService.pushPlan(cwd);
  }, []);

  const push = useCallback(async (plan: GitPushPlan): Promise<GitPushResult> => {
    const cwd = cwdRef.current;
    if (!cwd) throw new Error("没有可用的工作目录");
    setWriting(true);
    try {
      return await gitService.push({
        cwd,
        remote: plan.remote,
        branch: plan.branch,
        setUpstream: !plan.hasUpstream,
      });
    } finally {
      setWriting(false);
    }
  }, []);

  const inspectRollback = useCallback(async (): Promise<RollbackInspect> => {
    const cwd = cwdRef.current;
    const treeOid = preRoundTreeOid;
    const paths = rollbackTargetPaths(lastRound);
    if (!cwd || !treeOid || paths.length === 0) {
      return emptyRollbackInspect(paths.length, false);
    }

    const restorePaths: string[] = [];
    const deletePaths: string[] = [];
    try {
      const pre = await gitService.compareSnapshot({ cwd, treeOid, paths });
      for (const item of pre.items) {
        if (item.inSnapshot) restorePaths.push(item.path);
        else deletePaths.push(item.path);
      }
    } catch {
      return emptyRollbackInspect(paths.length, false);
    }

    const conflictOverwrite: string[] = [];
    const conflictDelete: string[] = [];
    const endOid = roundEndTreeOidRef.current;
    if (endOid && endOid !== treeOid) {
      try {
        const end = await gitService.compareSnapshot({
          cwd,
          treeOid: endOid,
          paths,
        });
        const restoreSet = new Set(restorePaths.map((p) => p.toLowerCase()));
        const deleteSet = new Set(deletePaths.map((p) => p.toLowerCase()));
        for (const item of end.items) {
          if (!item.differs) continue;
          const key = item.path.toLowerCase();
          if (deleteSet.has(key)) {
            conflictDelete.push(item.path);
          } else if (restoreSet.has(key)) {
            conflictOverwrite.push(item.path);
          } else if (item.inWorktree) {
            conflictOverwrite.push(item.path);
          } else {
            conflictDelete.push(item.path);
          }
        }
      } catch {
        // 冲突检测失败不阻断撤销，仅不提示冲突
      }
    }

    return {
      total: paths.length,
      restoreCount: restorePaths.length,
      deleteCount: deletePaths.length,
      conflictOverwrite,
      conflictDelete,
      loading: false,
    };
  }, [preRoundTreeOid, lastRound]);

  const rollbackLastRound = useCallback(async (): Promise<{
    restored: number;
    deleted: number;
  } | null> => {
    const cwd = cwdRef.current;
    const treeOid = preRoundTreeOid;
    if (!cwd || !treeOid || lastRound.length === 0 || rollingBack) return null;
    setRollingBack(true);
    try {
      const paths = rollbackTargetPaths(lastRound);
      const result = await gitService.rollback({ cwd, treeOid, paths });
      // 回滚成功后立刻作废快照，避免对已还原的工作区再次回滚
      clearRollbackState("empty");
      setSelectedKey(null);
      await refresh();
      return result;
    } finally {
      setRollingBack(false);
    }
  }, [preRoundTreeOid, lastRound, rollingBack, refresh, clearRollbackState]);

  /** 打开回滚确认弹窗并异步核对（按钮与全局快捷键共用；不可回滚时为空操作）。 */
  const requestRollbackPrompt = useCallback((): void => {
    if (preRoundTreeOid === null || lastRound.length === 0 || rollingBack) return;
    rollbackPromptSessionIdRef.current = activeSessionId;
    const total = rollbackTargetPaths(lastRound).length;
    setRollbackPromptInspect(emptyRollbackInspect(total, true));
    setRollbackPromptOpen(true);
    void inspectRollback()
      .then((result) => setRollbackPromptInspect(result))
      .catch(() => setRollbackPromptInspect(emptyRollbackInspect(total, false)));
  }, [preRoundTreeOid, lastRound, rollingBack, inspectRollback, activeSessionId]);

  const dismissRollbackPrompt = useCallback((): void => {
    setRollbackPromptOpen(false);
  }, []);

  const confirmRollbackPrompt = useCallback(async (): Promise<{
    restored: number;
    deleted: number;
  } | null> => {
    setRollbackPromptOpen(false);
    // 弹窗打开期间会话已切换：cwd/快照已换域，核对数据失真，放弃本次回滚而不是错删
    if (activeSessionId !== rollbackPromptSessionIdRef.current) return null;
    return rollbackLastRound();
  }, [rollbackLastRound, activeSessionId]);

  const rollbackBlockReason = useMemo<RollbackBlockReason>(() => {
    if (rollingBack) return "rolling";
    if (preRoundTreeOid !== null && lastRound.length > 0) return "ready";
    // 有本轮快照但无净变更（Agent 未改盘 / 已改回 / 刷新后为空）
    if (preRoundTreeOid !== null && lastRound.length === 0) return "empty";
    if (!sessionWorkingDir) return "noSession";
    if (phase === "notRepo") return "notRepo";
    // clearRollbackState 写入的原因（committed / empty / noSnapshot / noSession）
    if (storedBlockReason !== "ready") return storedBlockReason;
    return "noSnapshot";
  }, [rollingBack, preRoundTreeOid, lastRound, storedBlockReason, sessionWorkingDir, phase]);

  const value = useMemo<ReviewStoreValue>(() => {
    const staged = changes.filter((c) => c.layer === "staged");
    const unstaged = changes.filter((c) => c.layer === "unstaged");
    const untracked = changes.filter((c) => c.layer === "untracked");
    const paths = new Set(changes.map((c) => c.path));
    let additions = 0;
    let deletions = 0;
    for (const change of changes) {
      if (change.additions !== null) additions += change.additions;
      if (change.deletions !== null) deletions += change.deletions;
    }
    const visibleChanges = sortChanges(
      filterMode === "staged"
        ? staged
        : filterMode === "unstaged"
          ? [...unstaged, ...untracked]
          : filterMode === "lastRound"
            ? lastRound
            : changes,
    );
    return {
      cwd: sessionWorkingDir,
      phase,
      refreshing,
      error,
      repoRoot,
      changes,
      staged,
      unstaged,
      untracked,
      lastRound,
      summary: { files: paths.size, additions, deletions },
      lastUpdated,
      changesVersion,
      filterMode,
      setFilterMode,
      reviewView,
      setReviewView,
      graphRefreshSeq,
      bumpGraphRefresh,
      visibleChanges,
      selectedKey,
      selectedChange: selectedKey
        ? (changes.find((c) => changeKey(c) === selectedKey) ?? null)
        : null,
      selectChange,
      clearSelection,
      refresh,
      refreshIfStale,
      canRollback: preRoundTreeOid !== null && lastRound.length > 0,
      rollbackBlockReason,
      rollingBack,
      rollbackLastRound,
      inspectRollback,
      rollbackPromptOpen,
      rollbackPromptInspect,
      requestRollbackPrompt,
      dismissRollbackPrompt,
      confirmRollbackPrompt,
      writing,
      stageChanges,
      unstageChanges,
      discardChanges,
      commit,
      fetchPushPlan,
      push,
    };
  }, [
    sessionWorkingDir,
    phase,
    refreshing,
    error,
    repoRoot,
    changes,
    lastRound,
    lastUpdated,
    changesVersion,
    filterMode,
    reviewView,
    graphRefreshSeq,
    bumpGraphRefresh,
    selectedKey,
    selectChange,
    clearSelection,
    refresh,
    refreshIfStale,
    preRoundTreeOid,
    rollbackBlockReason,
    rollingBack,
    rollbackLastRound,
    inspectRollback,
    rollbackPromptOpen,
    rollbackPromptInspect,
    requestRollbackPrompt,
    dismissRollbackPrompt,
    confirmRollbackPrompt,
    writing,
    stageChanges,
    unstageChanges,
    discardChanges,
    commit,
    fetchPushPlan,
    push,
  ]);

  return <ReviewStoreContext.Provider value={value}>{children}</ReviewStoreContext.Provider>;
}

export function useReviewStore(): ReviewStoreValue {
  const ctx = useContext(ReviewStoreContext);
  if (!ctx) throw new Error("useReviewStore 必须在 ReviewProvider 内使用");
  return ctx;
}

/** 供面板排序/展示使用的稳定次序（layer 内按路径排序）。 */
export function sortChanges(changes: GitChange[]): GitChange[] {
  return [...changes].sort((a, b) => a.path.localeCompare(b.path));
}
