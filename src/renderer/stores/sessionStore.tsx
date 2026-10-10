import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { SessionStartReason } from "../../shared/contribution";
import { t } from "../../shared/i18n";
import type {
  PiContextBreakdownSlice,
  PiContextUsage,
  PiImageContent,
  PiModelInputModality,
  PiSlashCommand,
  SessionId,
  SessionSummary,
} from "../../shared/ipc";
import type { BrowserConsoleError, BrowserContextItem } from "../services/browserService";
import { piService } from "../services/piService";
import { procService } from "../services/procService";
import { sessionService } from "../services/sessionService";
import { settingsService } from "../services/settingsService";
import { readSlashCommandCache, writeSlashCommandCache } from "../services/slashCommandCache";
import { prefetchService } from "../services/workerService";
import { piImageFromDisplay, type UserMessageImage } from "../utils/imageAttach";
import { buildPageContext } from "../utils/pageContext";
import { getComposerThinkingLevel } from "./composerStore";
import { isModeTransitioning } from "./modeTransitionBarrier";
import { useProjectStore } from "./projectStore";
import {
  applyEntries,
  claimFile,
  clearStartPending,
  clearUnread,
  createBucketsState,
  deriveRunningFiles,
  dropFileIndex,
  emptyBucket,
  ensureBucket,
  findCommandBorrowSessionId,
  getActiveBucket,
  indexFileOnly,
  isFileProcessAlive,
  isFileRunning,
  loadMessagesIntoBucket,
  markUnread,
  patchBucket,
  type SessionBucketsState,
  type SessionPhase,
  setActiveKey,
} from "./sessionBuckets";
import { notifySessionRuntimeContext } from "./sessionContextBridge";
import type { SessionEntry } from "./sessionTranscript";
import { type PageId, useUiStore } from "./uiStore";
import { useRuntimeReconciliation } from "./useRuntimeReconciliation";

/** 低频会话元数据与动作：侧栏、标题、输入栏、run 头按钮等；不订阅 entries。 */
interface SessionMetaValue {
  phase: SessionPhase;
  /** 当前 active 桶的运行时 SessionId；空态为 null。 */
  activeSessionId: SessionId | null;
  /** 全部 pi 会话历史（含各会话工作目录，侧边栏按项目分组展示）。 */
  allSessions: SessionSummary[];
  /** 活动会话对应的 JSONL 文件（恢复历史会话时非空）。 */
  activeSessionFile: string | null;
  /** 完成未读的 JSONL 文件集合（侧边栏多绿点）。 */
  unreadFiles: ReadonlySet<string>;
  /** 兼容旧调用：仅当恰好只有一个未读时为该文件，否则 null。 */
  unreadDoneFile: string | null;
  /** 运行中的会话 JSONL 集合（侧栏多旋转）。 */
  runningFiles: ReadonlySet<string>;
  /** 置顶的会话文件（数组顺序即置顶顺序）。 */
  pinnedFiles: string[];
  /** 已归档的会话（JSONL 绝对路径 → 归档时间 Unix ms）；侧栏主列表不展示，管理入口在设置页（docs/design/32）。 */
  archivedFiles: Record<string, number>;
  /** 会话自定义标题（JSONL 绝对路径 → 用户重命名后的标题）。 */
  sessionTitles: Record<string, string>;
  /** 主进程当前 active 会话是否有存活 pi 进程。 */
  processAlive: boolean;
  /** 存活 pi 进程的会话数（含后台 Tab）；> 0 表示存在任意活跃会话。 */
  liveSessionCount: number;
  /** 切换目标 JSONL 文件；null 表示无进行中的切换（仅 active）。 */
  switchingTo: string | null;
  /** 历史是否已从磁盘/缓存装载（仅 active）。 */
  transcriptReady: boolean;
  /** active 桶冷启动进行中（send 触发的 spawn 未 settle；PiColdStartBar 驱动源）。 */
  startPending: boolean;
  /** pi 配置 / 会话生效的模型展示。 */
  modelLabel: string;
  /** 当前模型输入模态（null = 未知，不拦附图）。 */
  modelInput: PiModelInputModality[] | null;
  /** active 桶上下文用量；null = 尚未拉取或会话未启动。 */
  contextUsage: PiContextUsage | null;
  /** active 桶分类占比（估算相对值）。 */
  contextBreakdown: PiContextBreakdownSlice[] | null;
  /** active 桶残差占比（>40 注明含系统提示与工具定义）。 */
  contextOtherPercent: number | null;
  /** active 桶模型窗口（stats 未返回时的分母兜底）。 */
  contextWindow: number | null;
  /** active 桶自动压缩开关。 */
  autoCompactionEnabled: boolean;
  /** pi 是否就绪（版本解析成功）。 */
  piReady: boolean;
  /** 当前会话生效的工作目录。 */
  sessionWorkingDir: string | null;
  /** 当前会话首条非空用户消息（标题回退用）。 */
  firstUserText: string | null;
  /** 若 pi RPC 未启动则启动（不改 phase）；用于模型等 RPC 预热。 */
  ensureSession: (reason?: SessionStartReason) => Promise<SessionId | null>;
  /**
   * 拉取 pi 斜杠命令（docs/会话进程懒加载方案 §5.2）：active 存活走自身 RPC；
   * 冷桶借用同 cwd 存活实例或命中 cwd 级缓存，零 spawn；都未命中才 ensureSession。
   */
  getSlashCommands: () => Promise<PiSlashCommand[]>;
  /** 新建任务：新建空桶并设为 active，**不杀**其它会话进程（Ctrl+N）。 */
  newSession: () => void;
  togglePin: (file: string) => void;
  /** 归档会话：JSONL 保留；有存活实例先结束，active 让位，置顶联动清除（docs/design/32）。 */
  archiveSession: (file: string) => void;
  /** 取消归档：会话回到侧栏主列表（设置页归档面板「恢复」用）。 */
  unarchiveSession: (file: string) => void;
  renameSession: (file: string, title: string) => void;
  /** 移除历史会话（回收站）：若 file 有存活实例则先 dispose 再删文件。 */
  removeSession: (file: string) => Promise<void>;
  /**
   * 侧栏「结束进程」：dispose 该 file 对应实例，JSONL 保留。
   * keepBackground=true 时保留后台进程登记（不 stopAll）。
   */
  endSessionProcess: (file: string, opts?: { keepBackground?: boolean }) => void;
  /** 该 file 是否有存活 pi 实例（行菜单「结束进程」可见性）。 */
  isFileProcessAlive: (file: string) => boolean;
  /** 该 file 是否正在 running（确认文案用）。 */
  isFileRunning: (file: string) => boolean;
  send: (
    text: string,
    context?: {
      items?: BrowserContextItem[];
      consoleErrors?: BrowserConsoleError[];
      /** 发给 pi 的 ImageContent（base64 无 data: 前缀）。 */
      images?: PiImageContent[];
      /** 气泡/历史展示图。 */
      displayImages?: UserMessageImage[];
    },
  ) => Promise<void>;
  /** 停止：仅 abort active 实例。 */
  stop: () => void;
  canRetryLastUser: boolean;
  retryLastUserMessage: () => Promise<void>;
  addSnapshot: (snapshot: { base64: string; url: string }) => void;
  /** 恢复 / 切换历史会话（setActive + 读盘展示；无进程不 spawn，发送才拉起）。 */
  openSessionFile: (file: string, cwd?: string) => Promise<void>;
  /** 侧栏历史重扫（定时任务派发新会话等主进程侧落盘变化的外部刷新入口）。 */
  refreshSidebarSessions: () => Promise<void>;
  /** 运行时 SessionId → JSONL 路径（桌面通知点击回跳，docs/design/24）。 */
  getSessionFileById: (sessionId: string) => string | null;
  /** JSONL 路径 → 运行时 SessionId（后台进程归属查询用）。 */
  getSessionIdForFile: (file: string) => SessionId | null;
  refreshModelState: () => Promise<void>;
  /** 拉取上下文用量（get_session_stats）；agent_end / compaction_end / 手动点击触发，不轮询。 */
  refreshContextUsage: (sessionId?: SessionId) => Promise<void>;
}

/** 高频会话文档流：仅 SessionView / 相关条目组件订阅（active 桶）。 */
interface SessionTranscriptValue {
  entries: SessionEntry[];
}

const SessionMetaContext = createContext<SessionMetaValue | null>(null);
const SessionTranscriptContext = createContext<SessionTranscriptValue | null>(null);

type BucketsAction =
  | { type: "replace"; state: SessionBucketsState }
  | { type: "setState"; fn: (prev: SessionBucketsState) => SessionBucketsState };

type StartBucketOpts = {
  sessionFile?: string;
  cwd?: string;
  makeActive?: boolean;
  reason?: SessionStartReason;
};

function bucketsReducer(state: SessionBucketsState, action: BucketsAction): SessionBucketsState {
  if (action.type === "replace") return action.state;
  return action.fn(state);
}

function newLocalSessionId(): SessionId {
  return `sess_ui_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/** 尚未落盘 JSONL 的会话在侧栏用的占位 file key。 */
const PENDING_FILE_PREFIX = "pending:";

function pendingFileKey(sessionId: SessionId): string {
  return `${PENDING_FILE_PREFIX}${sessionId}`;
}

/** 是否为尚未落盘的占位会话行（侧栏乐观插入）；导出供 UI 层做菜单可见性判定。 */
export function isPendingFile(file: string): boolean {
  return file.startsWith(PENDING_FILE_PREFIX);
}

function sessionIdFromPendingFile(file: string): SessionId | null {
  return isPendingFile(file) ? file.slice(PENDING_FILE_PREFIX.length) : null;
}

function firstUserTextOf(entries: SessionEntry[]): string | null {
  for (const entry of entries) {
    if (entry.kind === "user" && entry.text.trim()) {
      return entry.text.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/**
 * 磁盘历史 + 未落盘会话的乐观侧栏条目。
 * 新会话在 pi 写出 JSONL 前也要能立刻出现在左侧列表。
 * 注意：sessionFile 为 pending: 占位时仍视为「未落盘」。
 */
export function mergeSessionLists(
  disk: SessionSummary[],
  buckets: ReadonlyMap<
    SessionId,
    {
      sessionId: SessionId;
      sessionFile: string | null;
      cwd: string | null;
      entries: SessionEntry[];
      processAlive: boolean;
      phase: SessionPhase;
    }
  >,
): SessionSummary[] {
  const pending: SessionSummary[] = [];
  for (const bucket of buckets.values()) {
    const realFile =
      bucket.sessionFile && !isPendingFile(bucket.sessionFile) ? bucket.sessionFile : null;
    if (realFile) continue;
    const firstUser = firstUserTextOf(bucket.entries);
    const interesting =
      Boolean(firstUser) ||
      bucket.processAlive ||
      bucket.phase === "running" ||
      Boolean(bucket.sessionFile && isPendingFile(bucket.sessionFile));
    if (!interesting) continue;
    const now = Date.now();
    const file =
      bucket.sessionFile && isPendingFile(bucket.sessionFile)
        ? bucket.sessionFile
        : pendingFileKey(bucket.sessionId);
    pending.push({
      file,
      id: bucket.sessionId,
      startedAt: now,
      updatedAt: now,
      firstUserMessage: firstUser ?? "新会话",
      cwd: bucket.cwd,
    });
  }
  if (pending.length === 0) return disk;
  return [...pending, ...disk].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 从磁盘 diff 里挑出本会话新建的 JSONL（claim 判定纯逻辑，便于单测）。
 * 首条用户消息能精确对应（两侧都归一化空白）时优先精确匹配：
 * 两个新会话的 JSONL 几乎同时落盘时，先认领的桶按 startedAt 抢「最新」会拿错文件；
 * 无匹配时回退「最新优先」（created 已按 startedAt 降序，即原行为）。
 */
export function pickClaimedFile(
  created: SessionSummary[],
  taken: ReadonlySet<string>,
  firstUserText: string | null,
): string | null {
  const free = created.filter((s) => !taken.has(s.file) && !isPendingFile(s.file));
  if (free.length === 0) return null;
  if (firstUserText) {
    const hit = free.find(
      (s) =>
        s.firstUserMessage != null &&
        s.firstUserMessage.replace(/\s+/g, " ").trim() === firstUserText,
    );
    if (hit) return hit.file;
  }
  return free[0]?.file ?? null;
}

/** 会话状态（多实例并行 + 单 active，docs/多会话并行架构方案 Phase B）。 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { currentProject } = useProjectStore();
  const { page, navigate, showToast } = useUiStore();
  const [bucketsState, dispatchBuckets] = useReducer(bucketsReducer, undefined, createBucketsState);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [archivedFiles, setArchivedFiles] = useState<Record<string, number>>({});
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [modelLabel, setModelLabel] = useState("pi");
  const [modelInput, setModelInput] = useState<PiModelInputModality[] | null>(null);
  const [piReady, setPiReady] = useState(false);
  const [switchingToFile, setSwitchingToFile] = useState<string | null>(null);

  const bucketsStateRef = useRef(bucketsState);
  bucketsStateRef.current = bucketsState;
  const pageRef = useRef<PageId>("session");
  pageRef.current = page;
  const allSessionsRef = useRef<SessionSummary[]>([]);
  const cwdRef = useRef<string | undefined>(undefined);
  cwdRef.current = currentProject?.dir;
  /** 高频动作只读 ref，避免 useCallback 依赖桶 state 导致闭包过期。 */
  const activeKeyRef = useRef<SessionId | null>(null);
  activeKeyRef.current = bucketsState.activeKey;

  const activeBucket = getActiveBucket(bucketsState);
  const phase = activeBucket?.phase ?? "empty";
  const processAlive = activeBucket?.processAlive ?? false;
  const transcriptReady = activeBucket?.transcriptReady ?? false;
  const startPending = activeBucket?.startPending ?? false;
  /** 侧栏选中态：未落盘时用 pending key，保证乐观历史行能高亮。 */
  const activeSessionFile =
    activeBucket?.sessionFile && !isPendingFile(activeBucket.sessionFile)
      ? activeBucket.sessionFile
      : activeBucket &&
          (activeBucket.processAlive ||
            activeBucket.phase === "running" ||
            activeBucket.entries.some((e) => e.kind === "user"))
        ? (activeBucket.sessionFile ?? pendingFileKey(activeBucket.sessionId))
        : null;
  const sessionWorkingDir = activeBucket?.cwd ?? currentProject?.dir ?? null;

  const unreadDoneFile = useMemo(() => {
    if (bucketsState.unreadFiles.size === 1) {
      const [only] = [...bucketsState.unreadFiles];
      return only ?? null;
    }
    return null;
  }, [bucketsState.unreadFiles]);

  const runningFiles = useMemo(() => deriveRunningFiles(bucketsState), [bucketsState]);

  // runningFiles 只含生成中的会话；存活但空闲的进程是 processAlive && phase === "idle"，
  // 不在内。MCP 面板的重载 / /mcp 动作面向所有活跃会话（主进程回退到任一存活实例），
  // 前置判定用进程存活口径而不是 active 桶。
  const liveSessionCount = useMemo(() => {
    let count = 0;
    for (const bucket of bucketsState.buckets.values()) {
      if (bucket.processAlive) count += 1;
    }
    return count;
  }, [bucketsState]);

  const setState = useCallback((fn: (prev: SessionBucketsState) => SessionBucketsState) => {
    dispatchBuckets({ type: "setState", fn });
  }, []);
  useRuntimeReconciliation(setState);

  /** active 切换：绑定 sessionService 当前 id（进程绑定型 IPC 路由用）。 */
  const bindActive = useCallback((id: SessionId | null) => {
    sessionService.bindActiveSession(id);
    activeKeyRef.current = id;
  }, []);

  /** 磁盘 listAll 最近一次结果（claim diff 用）；侧栏展示 = disk + pending 合并。 */
  const diskSessionsRef = useRef<SessionSummary[]>([]);
  const refreshTimerRef = useRef<number | null>(null);

  const applyDiskSessions = useCallback((disk: SessionSummary[]): SessionSummary[] => {
    diskSessionsRef.current = disk;
    allSessionsRef.current = disk;
    const merged = mergeSessionLists(disk, bucketsStateRef.current.buckets);
    setAllSessions(merged);
    return disk;
  }, []);

  /** 桶状态变化后重算侧栏（不发起 listAll）。 */
  const rematerializeSidebar = useCallback((): void => {
    setAllSessions(mergeSessionLists(diskSessionsRef.current, bucketsStateRef.current.buckets));
  }, []);

  /**
   * 桶提交后再刷新侧栏。
   * setState 是异步的：同 tick 里 bucketsStateRef 仍是旧值，
   * 必须等 React 提交（本 effect）再 merge，否则乐观历史永远出不来。
   */
  const sidebarSyncKey = useMemo(() => {
    const parts: string[] = [];
    for (const b of bucketsState.buckets.values()) {
      const first = firstUserTextOf(b.entries);
      parts.push(
        [
          b.sessionId,
          b.sessionFile ?? "",
          b.processAlive ? "1" : "0",
          b.phase,
          first ? "1" : "0",
          String(b.entries.length),
        ].join(":"),
      );
    }
    return parts.sort().join("|");
  }, [bucketsState]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sidebarSyncKey 作为桶变更触发器，不在闭包内读取
  useEffect(() => {
    rematerializeSidebar();
  }, [sidebarSyncKey, rematerializeSidebar]);

  /** 同步写入一条 pending 摘要（发送瞬间，不依赖 bucket 提交）。 */
  const upsertPendingSummary = useCallback(
    (sessionId: SessionId, text: string, cwd: string | null): void => {
      const file = pendingFileKey(sessionId);
      const summary: SessionSummary = {
        file,
        id: sessionId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        firstUserMessage: text.replace(/\s+/g, " ").trim() || "新会话",
        cwd,
      };
      setAllSessions((prev) => [summary, ...prev.filter((s) => s.file !== file)]);
    },
    [],
  );

  /** 回收预插的 pending 行（start 失败时），避免孤儿占位；下次 merge 本也会自然清掉。 */
  const dropPendingSummary = useCallback((sessionId: SessionId): void => {
    const file = pendingFileKey(sessionId);
    setAllSessions((prev) => prev.filter((s) => s.file !== file));
  }, []);

  const loadSessions = useCallback(async (): Promise<SessionSummary[]> => {
    const disk = await sessionService.listAll();
    return applyDiskSessions(disk);
  }, [applyDiskSessions]);

  /** 侧栏刷新：短防抖，避免高频 agent 事件打爆 listAll。 */
  const refreshSessions = useCallback(async (): Promise<void> => {
    if (refreshTimerRef.current != null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadSessions();
    }, 120);
  }, [loadSessions]);

  /**
   * 为指定会话认领 JSONL 文件（**不得**用 active file 顶替后台会话）。
   * 并发 agent_start 时对 claim 做串行队列，避免两个无 file 桶抢同一条 diff。
   */
  const claimQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const claimSessionFile = useCallback(
    async (sessionId: SessionId): Promise<string | null> => {
      const run = async (): Promise<string | null> => {
        const current = bucketsStateRef.current.buckets.get(sessionId);
        if (current?.sessionFile) return current.sessionFile;
        const before = diskSessionsRef.current;
        const sessions = await loadSessions();
        const now = bucketsStateRef.current.buckets.get(sessionId);
        if (now?.sessionFile) return now.sessionFile;
        const known = new Set(before.map((s) => s.file));
        const created = sessions
          .filter((s) => !known.has(s.file))
          .sort((a, b) => b.startedAt - a.startedAt);
        const taken = new Set(
          [...bucketsStateRef.current.fileIndex.keys()].concat(
            [...bucketsStateRef.current.buckets.values()]
              .map((b) => b.sessionFile)
              .filter((f): f is string => f != null),
          ),
        );
        const bucket = bucketsStateRef.current.buckets.get(sessionId);
        const claimed = pickClaimedFile(created, taken, firstUserTextOf(bucket?.entries ?? []));
        if (claimed) {
          setState((prev) => {
            let next = claimFile(prev, sessionId, claimed);
            next = dropFileIndex(next, pendingFileKey(sessionId));
            return next;
          });
          // 磁盘列表乐观合并，侧栏立刻从 pending 换成真实文件
          const optimistic: SessionSummary = {
            file: claimed,
            id: sessionId,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            firstUserMessage: firstUserTextOf(bucket?.entries ?? []),
            cwd: bucket?.cwd ?? null,
          };
          diskSessionsRef.current = [
            optimistic,
            ...diskSessionsRef.current.filter((s) => s.file !== claimed),
          ];
          allSessionsRef.current = diskSessionsRef.current;
          rematerializeSidebar();
        } else {
          rematerializeSidebar();
        }
        return claimed;
      };
      const task = claimQueueRef.current.then(run, run);
      claimQueueRef.current = task.catch(() => undefined);
      return task;
    },
    [loadSessions, rematerializeSidebar, setState],
  );

  /** 发送后立刻在侧栏出现，并轮询认领 JSONL（不等整轮 agent_end）。 */
  const scheduleClaim = useCallback(
    (sessionId: SessionId): void => {
      const delays = [250, 600, 1200, 2500, 5000];
      let i = 0;
      const tick = (): void => {
        void claimSessionFile(sessionId).then((file) => {
          rematerializeSidebar();
          if (file) return;
          if (i < delays.length) {
            const delay = delays[i];
            i += 1;
            window.setTimeout(tick, delay);
          }
        });
      };
      window.setTimeout(tick, 150);
    },
    [claimSessionFile, rematerializeSidebar],
  );

  const refreshModelState = useCallback(async (): Promise<void> => {
    const id = activeKeyRef.current;
    const state = id
      ? await sessionService.getModelState(id)
      : await sessionService.getModelState();
    if (state?.modelLabel) {
      setModelLabel(state.modelLabel);
      setModelInput(state.modelInput ?? null);
      if (id) {
        setState((prev) =>
          patchBucket(prev, id, {
            contextWindow: state.contextWindow ?? null,
            autoCompactionEnabled: state.autoCompactionEnabled === true,
          }),
        );
      }
      return;
    }
    const info = await piService.info();
    if (!info) return;
    setPiReady(info.version !== null);
    if (info.model) {
      const prefix = info.provider ? `${info.provider}/` : "";
      const suffix = info.thinkingLevel ? `:${info.thinkingLevel}` : "";
      setModelLabel(`${prefix}${info.model}${suffix}`);
    }
  }, [setState]);

  /** 上下文用量：只在 agent_end / compaction_end / set_model / 手动点击时拉取，不挂 message_update。 */
  const refreshContextUsage = useCallback(
    async (sessionId?: SessionId): Promise<void> => {
      const id = sessionId ?? activeKeyRef.current;
      if (!id) return;
      const stats = await sessionService.getStats(id);
      setState((prev) =>
        patchBucket(prev, id, {
          contextUsage: stats?.contextUsage ?? null,
          contextBreakdown: stats?.breakdown ?? null,
          contextOtherPercent: stats?.otherPercent ?? null,
          contextWindow:
            stats?.contextUsage?.contextWindow ?? prev.buckets.get(id)?.contextWindow ?? null,
        }),
      );
    },
    [setState],
  );

  /**
   * 启动 / 复用实例。同 file 复用时主进程返回既有 SessionId，不 spawn 第二个。
   * 不同 file 可并行 start；**不再**用全局 startSeq 取消另一次 spawn。
   */
  /** start 成功后的 file → sessionId 缓存（reload 后 fileIndex 为空时用于 dispose/remove）。 */
  const sessionIdByFileRef = useRef(new Map<string, SessionId>());

  const runStartBucket = useCallback(
    async (bucketId: SessionId, opts: StartBucketOpts): Promise<SessionId | null> => {
      const activeAtStart = activeKeyRef.current;
      setState((prev) =>
        patchBucket(prev, bucketId, {
          sessionFile: opts.sessionFile ?? prev.buckets.get(bucketId)?.sessionFile ?? null,
          cwd: opts.cwd ?? prev.buckets.get(bucketId)?.cwd ?? null,
        }),
      );
      try {
        // 传入 bucketId：新 spawn 时 PIDESK_VIEW_SESSION = 渲染层桶 id，与 active 对齐。
        // 同 file 复用时主进程仍返回既有权威 id，下方 remap。
        const id = await sessionService.start({
          sessionId: bucketId,
          cwd: opts.cwd,
          sessionFile: opts.sessionFile,
          reason: opts.reason ?? "send",
        });
        if (opts.sessionFile) sessionIdByFileRef.current.set(opts.sessionFile, id);
        const shouldActivate = opts.makeActive !== false && activeKeyRef.current === activeAtStart;
        setState((prev) => {
          let next = prev;
          if (id !== bucketId) {
            // 权威 id 与临时桶不同：迁移到权威 id，保留 transcript / switchId
            const src = prev.buckets.get(bucketId);
            if (src && !prev.buckets.has(id)) {
              const buckets = new Map(prev.buckets);
              buckets.delete(bucketId);
              buckets.set(
                id,
                emptyBucket(id, {
                  processAlive: true,
                  phase: src.phase === "running" ? "running" : "idle",
                  sessionFile: opts.sessionFile ?? src.sessionFile,
                  cwd: opts.cwd ?? src.cwd,
                  transcriptReady: src.transcriptReady,
                  switching: src.switching,
                  switchId: src.switchId,
                  entries: src.entries,
                  // 冷启动进度条随桶迁移保留，spawn 成功前不能提前消失（§3.2）
                  startPending: src.startPending,
                }),
              );
              next = { ...prev, buckets };
            } else {
              next = patchBucket(prev, id, {
                processAlive: true,
                switchId: src?.switchId ?? prev.buckets.get(id)?.switchId ?? 0,
                transcriptReady:
                  src?.transcriptReady ?? prev.buckets.get(id)?.transcriptReady ?? false,
              });
            }
            if (opts.sessionFile) {
              const fileIndex = new Map(next.fileIndex);
              fileIndex.set(opts.sessionFile, id);
              next = { ...next, fileIndex };
            }
          } else {
            next = patchBucket(prev, id, { processAlive: true });
            if (opts.sessionFile) next = claimFile(next, id, opts.sessionFile);
          }
          // active 必须钉在主进程返回的权威 id 上，才能与 View 的 sessionId 对齐
          if (shouldActivate) {
            next = setActiveKey(next, id);
          }
          return next;
        });
        if (shouldActivate) bindActive(id);
        notifySessionRuntimeContext(id, {
          cwd: opts.cwd ?? null,
          sessionFile: opts.sessionFile ?? null,
          processAlive: true,
        });
        if (shouldActivate) {
          void prefetchService
            .notifyActive({
              sessionId: id,
              sessionFile: opts.sessionFile ?? null,
              cwd: opts.cwd ?? null,
            })
            .catch(() => {});
        }
        void refreshModelState();
        return id;
      } catch (err) {
        const message = err instanceof Error ? err.message : "pi 启动失败";
        showToast(message);
        setState((prev) => patchBucket(prev, bucketId, { processAlive: false }));
        return null;
      }
    },
    [bindActive, refreshModelState, setState, showToast],
  );

  /**
   * 同桶并发 start（slash 预热 ensureSession ∥ send）合并为一次 IPC start：
   * 主进程的 TOCTOU 防护只覆盖带 sessionFile 的请求，无 file 的并发 start
   * 会各自 spawn 并把第一个 child 顶成孤儿；opts 以首拍为准。
   */
  const startInflightRef = useRef(new Map<SessionId, Promise<SessionId | null>>());
  const startBucket = useCallback(
    (bucketId: SessionId, opts: StartBucketOpts): Promise<SessionId | null> => {
      const inflight = startInflightRef.current.get(bucketId);
      if (inflight) return inflight;
      const task = runStartBucket(bucketId, opts).finally(() => {
        startInflightRef.current.delete(bucketId);
      });
      startInflightRef.current.set(bucketId, task);
      return task;
    },
    [runStartBucket],
  );

  // pi 事件流：按 sessionId 写入对应桶
  useEffect(() => {
    void refreshSessions();

    const applySideEffects = (sessionId: SessionId, type: string): void => {
      setState((prev) => {
        let next = ensureBucket(prev, sessionId);
        const bucket = next.buckets.get(sessionId);
        if (type === "agent_start") {
          next = patchBucket(next, sessionId, { phase: "running" });
          return next;
        }
        if (type === "agent_end" || type === "agent_settled") {
          next = patchBucket(next, sessionId, { phase: "idle" });
          return next;
        }
        if (bucket) return prev;
        return next;
      });
      if (type === "agent_start") {
        void claimSessionFile(sessionId);
        scheduleClaim(sessionId);
      } else if (type === "agent_end") {
        void claimSessionFile(sessionId).then((file) => {
          rematerializeSidebar();
          if (!file) return;
          const st = bucketsStateRef.current;
          const isActive = st.activeKey === sessionId && pageRef.current === "session";
          if (!isActive) {
            setState((prev) => markUnread(prev, file));
          }
        });
        void refreshContextUsage(sessionId);
      } else if (type === "compaction_end") {
        // 压缩后 percent 可能为 null（pi 契约），chip 显示 `?`；下一次 agent_end 恢复数字
        void refreshContextUsage(sessionId);
      }
    };

    return sessionService.subscribe((message) => {
      const sessionId = message.sessionId;

      if (message.type === "event") {
        applySideEffects(sessionId, message.payload.type);
        setState((prev) =>
          applyEntries(prev, sessionId, { type: "event", event: message.payload }),
        );
        return;
      }
      if (message.type === "eventBatch") {
        for (const event of message.payload) {
          applySideEffects(sessionId, event.type);
        }
        setState((prev) =>
          applyEntries(prev, sessionId, { type: "events", events: message.payload }),
        );
        return;
      }
      if (message.type === "exit") {
        setState((prev) => {
          let next = ensureBucket(prev, sessionId);
          const bucket = next.buckets.get(sessionId);
          // 结束进程：transcript 保留，phase 停在 idle，不落 empty（不闪 WelcomeSplash）
          const phaseOut: SessionPhase = bucket?.phase === "empty" ? "empty" : "idle";
          next = patchBucket(next, sessionId, {
            processAlive: false,
            phase: phaseOut,
            switching: false,
          });
          // 进程退出时收口仍 open 的 run，否则 run 头计时会永远走下去
          next = applyEntries(next, sessionId, { type: "userStop" });
          // fileIndex 保留：侧栏状态展示仍要用；进程死透后同 file 冷启动由 start 重写索引
          return next;
        });
        notifySessionRuntimeContext(sessionId, { processAlive: false });
        if (sessionId === activeKeyRef.current) {
          // 仅 active 的 exit 影响输入栏就绪态（processAlive 已 false）
        }
        void refreshSessions();
        return;
      }
      // stderr / 进程异常：按 sessionId 入桶，不写 active
      console.warn("[pi]", sessionId, message.payload);
      setState((prev) =>
        applyEntries(prev, sessionId, {
          type: "processError",
          message: message.payload,
        }),
      );
    });
  }, [
    refreshSessions,
    claimSessionFile,
    scheduleClaim,
    rematerializeSidebar,
    setState,
    refreshContextUsage,
  ]);

  // 回到会话页且 active 的 file 未读 → 清除该条（不误清其它 unread）
  useEffect(() => {
    if (page !== "session" || !activeSessionFile) return;
    if (!bucketsState.unreadFiles.has(activeSessionFile)) return;
    setState((prev) => clearUnread(prev, activeSessionFile));
  }, [page, activeSessionFile, bucketsState.unreadFiles, setState]);

  useEffect(() => {
    const id = bucketsState.activeKey;
    void refreshModelState();
    void refreshContextUsage(id ?? undefined);
  }, [refreshModelState, refreshContextUsage, bucketsState.activeKey]);

  useEffect(() => {
    let cancelled = false;
    void settingsService.get().then((settings) => {
      if (cancelled || !settings) return;
      setPinnedFiles(settings.pinnedSessions);
      setArchivedFiles(settings.archivedSessions);
      setSessionTitles(settings.sessionTitles);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 预热：active 已有进程直接 true；否则冷启动 active（无 file 的新桶）。 */
  const ensureSession = useCallback(
    async (reason: SessionStartReason = "slash-command"): Promise<SessionId | null> => {
      const id = activeKeyRef.current;
      const st = bucketsStateRef.current;
      if (id) {
        const bucket = st.buckets.get(id);
        if (bucket?.processAlive) return id;
        const started = await startBucket(id, {
          sessionFile: bucket?.sessionFile ?? undefined,
          cwd: bucket?.cwd ?? cwdRef.current,
          makeActive: true,
          reason,
        });
        return started;
      }
      const newId = newLocalSessionId();
      const started = await startBucket(newId, { cwd: cwdRef.current, makeActive: true, reason });
      return started;
    },
    [startBucket],
  );

  /**
   * 斜杠命令列表（docs/会话进程懒加载方案 §5.2）：命令内容由 pi 配置 + cwd 下的
   * 扩展 / skills / prompt 模板决定，与会话内容无关，同 cwd 可共享。
   * active 存活 → 自身 RPC（顺手回写缓存）；冷桶 → 借用同 cwd 存活实例；
   * 借用落空或不存在 → 读 cwd 缓存；全部未命中才 ensureSession——
   * cwd 内第一个进程必须有人生出来（决策 #3）。
   */
  const getSlashCommands = useCallback(async (): Promise<PiSlashCommand[]> => {
    const id = activeKeyRef.current;
    const st = bucketsStateRef.current;
    const bucket = id ? (st.buckets.get(id) ?? null) : null;
    const cwd = bucket?.cwd ?? cwdRef.current ?? null;
    if (bucket?.processAlive && id) {
      const list = await sessionService.getCommands(id);
      writeSlashCommandCache(cwd, list);
      return list;
    }
    const borrowId = findCommandBorrowSessionId(st, cwd);
    if (borrowId) {
      const list = await sessionService.getCommands(borrowId);
      if (list.length > 0) {
        writeSlashCommandCache(cwd, list);
        return list;
      }
      // 借用实例可能恰在拉取间隙退出（getCommands 失败返回空）：
      // 落回缓存，不为一个菜单 spawn
    }
    const cached = readSlashCommandCache(cwd);
    if (cached) return cached;
    const ok = await ensureSession();
    if (!ok) return [];
    const list = await sessionService.getCommands();
    writeSlashCommandCache(cwd, list);
    return list;
  }, [ensureSession]);

  /**
   * 新建任务：切到空态（activeKey=null），**不杀**其它会话进程。
   * 首次 send / ensureSession 时再冷启动新实例。
   */
  const newSession = useCallback((): void => {
    setSwitchingToFile(null);
    setState((prev) => setActiveKey(prev, null));
    bindActive(null);
    navigate("session");
    void refreshSessions();
  }, [bindActive, navigate, refreshSessions, setState]);

  const commitPinned = useCallback((next: string[]): void => {
    setPinnedFiles(next);
    void settingsService.set({ pinnedSessions: next });
  }, []);

  const togglePin = useCallback(
    (file: string): void => {
      commitPinned(
        pinnedFiles.includes(file) ? pinnedFiles.filter((f) => f !== file) : [...pinnedFiles, file],
      );
    },
    [pinnedFiles, commitPinned],
  );

  const commitArchived = useCallback((next: Record<string, number>): void => {
    setArchivedFiles(next);
    void settingsService.set({ archivedSessions: next });
  }, []);

  /**
   * 归档会话（docs/design/32）：JSONL 不动，仅记 PiDesk 侧标记。
   * 与删除同款前置——同 file 存活实例先 dispose（归档即收起，不再有进程双写）、
   * active 让位回空态；置顶与归档互斥，未读标记一并清掉。
   */
  const archiveSession = useCallback(
    (file: string): void => {
      const st = bucketsStateRef.current;
      const id = st.fileIndex.get(file) ?? sessionIdByFileRef.current.get(file) ?? undefined;
      const wasActive =
        id !== undefined && st.activeKey === id
          ? true
          : st.activeKey === null
            ? false
            : st.buckets.get(st.activeKey as SessionId)?.sessionFile === file;
      if (id && (st.buckets.get(id)?.processAlive || isFileProcessAlive(st, file))) {
        sessionService.dispose(id);
      }
      sessionIdByFileRef.current.delete(file);
      if (pinnedFiles.includes(file)) commitPinned(pinnedFiles.filter((f) => f !== file));
      commitArchived({ ...archivedFiles, [file]: Date.now() });
      setState((prev) => {
        let next = dropFileIndex(prev, file);
        if (next.unreadFiles.has(file)) {
          const unread = new Set(next.unreadFiles);
          unread.delete(file);
          next = { ...next, unreadFiles: unread };
        }
        if (id) {
          const buckets = new Map(next.buckets);
          buckets.delete(id);
          next = { ...next, buckets };
        }
        if (wasActive) next = setActiveKey(next, null);
        return next;
      });
      if (wasActive) bindActive(null);
      void refreshSessions();
    },
    [
      archivedFiles,
      bindActive,
      commitArchived,
      commitPinned,
      pinnedFiles,
      refreshSessions,
      setState,
    ],
  );

  const unarchiveSession = useCallback(
    (file: string): void => {
      if (archivedFiles[file] === undefined) return;
      const next = { ...archivedFiles };
      delete next[file];
      commitArchived(next);
    },
    [archivedFiles, commitArchived],
  );

  const commitTitles = useCallback((next: Record<string, string>): void => {
    setSessionTitles(next);
    void settingsService.set({ sessionTitles: next });
  }, []);

  const renameSession = useCallback(
    (file: string, title: string): void => {
      const trimmed = title.trim();
      const next = { ...sessionTitles };
      if (trimmed) next[file] = trimmed;
      else delete next[file];
      commitTitles(next);
    },
    [sessionTitles, commitTitles],
  );

  /** 侧栏「结束进程」：dispose + 清 fileIndex；bucket/entries 保留。 */
  const endSessionProcess = useCallback(
    (file: string, opts?: { keepBackground?: boolean }): void => {
      const st = bucketsStateRef.current;
      const id = st.fileIndex.get(file) ?? sessionIdByFileRef.current.get(file) ?? null;
      if (!id) return;
      sessionIdByFileRef.current.delete(file);
      // 默认一并结束后台进程；keepBackground 时保留（docs/design/37 §6）
      if (!opts?.keepBackground) {
        void procService.stopAll(id);
      }
      sessionService.dispose(id);
      if (activeKeyRef.current === id) {
        // 保持中央区可回看 transcript，仅解绑 IPC 当前实例
        sessionService.bindActiveSession(null);
      }
      setState((prev) => {
        let next = dropFileIndex(prev, file);
        next = patchBucket(next, id, { processAlive: false, phase: "idle", switching: false });
        return next;
      });
      void refreshSessions();
    },
    [refreshSessions, setState],
  );

  const isFileProcessAliveCb = useCallback((file: string) => {
    const st = bucketsStateRef.current;
    if (isFileProcessAlive(st, file)) return true;
    // reload 后 fileIndex 可能为空：退回 start 缓存 + 桶 processAlive
    const cached = sessionIdByFileRef.current.get(file);
    return Boolean(cached && st.buckets.get(cached)?.processAlive);
  }, []);

  const isFileRunningCb = useCallback((file: string) => {
    const st = bucketsStateRef.current;
    if (isFileRunning(st, file)) return true;
    const cached = sessionIdByFileRef.current.get(file);
    if (!cached) return false;
    const bucket = st.buckets.get(cached);
    return Boolean(bucket?.processAlive && bucket.phase === "running");
  }, []);

  /** 删除任务：有存活实例先 dispose，再删 JSONL（结束 ≠ 删除）。 */
  const removeSession = useCallback(
    async (file: string): Promise<void> => {
      // 乐观 pending：只清本地桶，不碰磁盘
      const pendingId = sessionIdFromPendingFile(file);
      if (pendingId) {
        const st0 = bucketsStateRef.current;
        const b = st0.buckets.get(pendingId);
        if (b?.processAlive) sessionService.dispose(pendingId);
        if (st0.activeKey === pendingId) {
          setState((prev) => setActiveKey(prev, null));
          bindActive(null);
        }
        setState((prev) => {
          const buckets = new Map(prev.buckets);
          buckets.delete(pendingId);
          let next = { ...prev, buckets };
          next = dropFileIndex(next, file);
          return next;
        });
        rematerializeSidebar();
        return;
      }

      const st = bucketsStateRef.current;
      const id = st.fileIndex.get(file) ?? sessionIdByFileRef.current.get(file) ?? undefined;
      const wasActive =
        id !== undefined && st.activeKey === id
          ? true
          : st.activeKey === null
            ? false
            : st.buckets.get(st.activeKey as SessionId)?.sessionFile === file;
      // 同 file 存活实例必须先 dispose，避免删 JSONL 后进程仍双写
      // 删除整条会话：后台进程一并回收（结束 ≠ 删除，但删除是丢弃语义）
      if (id) void procService.stopAll(id);
      if (id && (st.buckets.get(id)?.processAlive || isFileProcessAlive(st, file))) {
        sessionService.dispose(id);
      }
      sessionIdByFileRef.current.delete(file);
      try {
        await sessionService.remove(file);
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("common.removeFailed"));
        return;
      }
      if (pinnedFiles.includes(file)) commitPinned(pinnedFiles.filter((f) => f !== file));
      if (archivedFiles[file] !== undefined) {
        const nextArchived = { ...archivedFiles };
        delete nextArchived[file];
        commitArchived(nextArchived);
      }
      if (sessionTitles[file] !== undefined) {
        const next = { ...sessionTitles };
        delete next[file];
        commitTitles(next);
      }
      setState((prev) => {
        let next = dropFileIndex(prev, file);
        next = {
          ...next,
          unreadFiles: (() => {
            if (!next.unreadFiles.has(file)) return next.unreadFiles;
            const u = new Set(next.unreadFiles);
            u.delete(file);
            return u;
          })(),
        };
        if (id) {
          const buckets = new Map(next.buckets);
          buckets.delete(id);
          next = { ...next, buckets };
        }
        if (wasActive) {
          next = setActiveKey(next, null);
        }
        return next;
      });
      if (wasActive) bindActive(null);
      void refreshSessions();
    },
    [
      archivedFiles,
      bindActive,
      commitArchived,
      commitPinned,
      commitTitles,
      pinnedFiles,
      refreshSessions,
      rematerializeSidebar,
      sessionTitles,
      setState,
      showToast,
    ],
  );

  const send = useCallback(
    async (
      text: string,
      context?: {
        items?: BrowserContextItem[];
        consoleErrors?: BrowserConsoleError[];
        images?: PiImageContent[];
        displayImages?: UserMessageImage[];
      },
    ): Promise<void> => {
      const trimmed = text.trim();
      const items = context?.items ?? [];
      const images = context?.images ?? [];
      const displayImages = context?.displayImages ?? [];
      if (!trimmed && items.length === 0 && images.length === 0) return;

      let targetId = activeKeyRef.current;
      if (isModeTransitioning(targetId)) return;
      if (!targetId) {
        targetId = newLocalSessionId();
        setState((prev) =>
          patchBucket(prev, targetId as SessionId, {
            phase: "empty",
            cwd: cwdRef.current,
          }),
        );
      }
      const bucket = bucketsStateRef.current.buckets.get(targetId) ?? null;
      // 同步乐观行（发送瞬间上侧栏，不等 setState 提交）：无 file 桶的 start 恒返回
      // bucketId（无 file 不可能 reuse），先于 start 插入才不会被主进程 start 内的
      // 模型对齐 RPC 拖延；已有真实 JSONL 的会话磁盘行已覆盖，不插 pending。
      if (!bucket?.sessionFile) {
        // 仅图无文时侧栏标题不能空白（docs/design/21）
        const pendingTitle =
          trimmed ||
          (displayImages.length > 0 ? `[图片] ${displayImages[0]?.name ?? ""}`.trim() : "");
        upsertPendingSummary(targetId, pendingTitle, bucket?.cwd ?? cwdRef.current ?? null);
      }
      if (!bucket?.processAlive) {
        // 冷启动进度条驱动源（docs/会话进程懒加载方案 §3.2）：成功/失败都要收尾；
        // 清理走 clearStartPending 判桶存在——迁移分支会 delete 旧桶，
        // patchBucket 的 ensureBucket 会把已删桶复活成僵尸桶
        setState((prev) => patchBucket(prev, targetId as SessionId, { startPending: true }));
        let started: SessionId | null = null;
        try {
          started = await startBucket(targetId, {
            sessionFile: bucket?.sessionFile ?? undefined,
            cwd: bucket?.cwd ?? cwdRef.current,
            makeActive: true,
          });
        } finally {
          setState((prev) => clearStartPending(prev, targetId as SessionId));
          if (started) {
            const startedId = started;
            setState((prev) => clearStartPending(prev, startedId));
          }
        }
        if (!started) {
          dropPendingSummary(targetId);
          return;
        }
        targetId = started;
        // 冷启动成功后补应用输入栏思考档位（§3.5）：spawn 参数不带 thinking，
        // 冷态改档位只写了本地 composerStore；不补发则实际跑 pi 默认档位。
        // 先于 prompt 发起即可保序，不阻塞发送；失败静默（不 toast、不回滚）。
        void sessionService
          .setThinkingLevel(getComposerThinkingLevel(), targetId)
          .catch(() => undefined);
      } else {
        bindActive(targetId);
      }

      const promptText =
        items.length > 0
          ? buildPageContext({ text: trimmed, items, consoleErrors: context?.consoleErrors ?? [] })
          : trimmed;
      setState((prev) => {
        let next = applyEntries(prev, targetId as SessionId, {
          type: "userMessage",
          text: trimmed,
          items,
          images: displayImages.length > 0 ? displayImages : undefined,
        });
        next = patchBucket(next, targetId as SessionId, { phase: "running" });
        // 未落盘：只登记 fileIndex 供 running/点击，sessionFile 仍留给真实 JSONL
        const b = next.buckets.get(targetId as SessionId);
        if (b && !b.sessionFile) {
          next = indexFileOnly(next, targetId as SessionId, pendingFileKey(targetId as SessionId));
        }
        return next;
      });
      scheduleClaim(targetId);
      try {
        sessionService.bindActiveSession(targetId);
        await sessionService.prompt(promptText, targetId, images.length > 0 ? images : undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : "发送失败";
        showToast(message);
        setState((prev) =>
          applyEntries(prev, targetId as SessionId, {
            type: "processError",
            message,
            title: "发送失败",
          }),
        );
        setState((prev) => patchBucket(prev, targetId as SessionId, { phase: "idle" }));
      }
    },
    [
      bindActive,
      dropPendingSummary,
      scheduleClaim,
      setState,
      showToast,
      startBucket,
      upsertPendingSummary,
    ],
  );

  const addSnapshot = useCallback(
    (snapshot: { base64: string; url: string }): void => {
      const id = activeKeyRef.current;
      if (!id) return;
      setState((prev) =>
        applyEntries(prev, id, { type: "snapshot", image: snapshot.base64, url: snapshot.url }),
      );
    },
    [setState],
  );

  const stop = useCallback((): void => {
    const id = activeKeyRef.current;
    if (!id) return;
    setState((prev) => applyEntries(prev, id, { type: "userStop" }));
    sessionService.stop(id);
  }, [setState]);

  const entries: SessionEntry[] = activeBucket?.entries ?? [];

  const firstUserText = useMemo(() => {
    for (const entry of entries) {
      if (entry.kind === "user" && entry.text.trim()) {
        return entry.text.replace(/\s+/g, " ").trim();
      }
    }
    return null;
  }, [entries]);

  const lastUserPayload = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (
        entry.kind === "user" &&
        (entry.text.trim().length > 0 || (entry.images?.length ?? 0) > 0)
      ) {
        return { text: entry.text, images: entry.images };
      }
    }
    return null;
  }, [entries]);

  const canRetryLastUser = lastUserPayload !== null && phase !== "running";

  const retryLastUserMessage = useCallback(async (): Promise<void> => {
    if (!lastUserPayload || phase === "running") return;
    const displayImages = lastUserPayload.images ?? [];
    const images = displayImages.map(piImageFromDisplay);
    await send(lastUserPayload.text, {
      ...(images.length > 0 ? { images, displayImages } : {}),
    });
  }, [lastUserPayload, phase, send]);

  /**
   * 打开 / 切换历史会话（docs/会话进程懒加载方案 Phase 1）：
   * - 目标已有存活进程 → 瞬时 setActive，兜底 transcript 加载
   * - 目标无进程 → 只读盘展示（零 spawn）；发送、/ 命令预热才拉起进程
   * - skeleton 只覆盖毫秒级磁盘读，switchingToFile 随读盘完成清除
   */
  /**
   * 正在打开的目标 file → { bucketId, switchId }（openSessionFile 竞态用）。
   * 值必须带 switchId：同 file 连续两次打开复用同一 openId（fileIndex 命中），
   * 只按 bucketId 比对无法区分两次打开——上一次的收尾块会删掉下一次的注册，
   * 下一次的读盘结果被守卫丢弃，switching 永久卡住（无 get_messages 兜底可回退）。
   */
  const openBucketByFileRef = useRef(new Map<string, { bucketId: SessionId; switchId: number }>());

  const openSessionFile = useCallback(
    async (file: string, cwd?: string): Promise<void> => {
      // 乐观 pending 条目：只切 active，不 start/读盘（进程可能已在跑）
      const pendingId = sessionIdFromPendingFile(file);
      if (pendingId) {
        const bucket = bucketsStateRef.current.buckets.get(pendingId);
        if (bucket) {
          setState((prev) => {
            let next = setActiveKey(prev, pendingId);
            if (cwd) next = patchBucket(next, pendingId, { cwd });
            return next;
          });
          bindActive(pendingId);
          setSwitchingToFile(null);
          navigate("session");
          rematerializeSidebar();
          return;
        }
      }

      const st = bucketsStateRef.current;
      // 优先 fileIndex，其次 start 成功时缓存的 file→sessionId（reload 后 fileIndex 可能为空）
      const existingId =
        st.fileIndex.get(file) ?? sessionIdByFileRef.current.get(file) ?? undefined;
      const existing = existingId ? st.buckets.get(existingId) : undefined;
      const hasLive =
        Boolean(existing?.processAlive) ||
        isFileProcessAlive(st, file) ||
        Boolean(existingId && st.buckets.get(existingId)?.processAlive);

      if (existingId && hasLive) {
        setState((prev) => {
          let next = setActiveKey(prev, existingId);
          next = patchBucket(next, existingId, {
            sessionFile: file,
            cwd: cwd ?? next.buckets.get(existingId)?.cwd ?? null,
          });
          next = clearUnread(next, file);
          return next;
        });
        bindActive(existingId);
        notifySessionRuntimeContext(existingId, {
          cwd: cwd ?? existing?.cwd ?? null,
          sessionFile: file,
          processAlive: true,
        });
        void prefetchService
          .notifyActive({
            sessionId: existingId,
            sessionFile: file,
            cwd: cwd ?? existing?.cwd ?? null,
            intent: "open",
          })
          .catch(() => {});
        setSwitchingToFile(null);
        navigate("session");
        void refreshModelState();
        if (!existing?.transcriptReady || existing.entries.length === 0) {
          // 热分支切换中 switchingToFile 已为 null，发送不被锁挡：
          // 兜底装载同样走合并守卫，避免清掉加载窗口期的乐观用户消息（§3.3）
          const startedAt = allSessionsRef.current.find((s) => s.file === file)?.startedAt;
          try {
            const { messages } = await sessionService.readTranscript(file);
            setState((prev) => loadMessagesIntoBucket(prev, existingId, messages, startedAt));
            setState((prev) =>
              patchBucket(prev, existingId, { transcriptReady: true, phase: "idle" }),
            );
          } catch {
            const messages = await sessionService.messages(existingId);
            setState((prev) => loadMessagesIntoBucket(prev, existingId, messages, startedAt));
            setState((prev) => patchBucket(prev, existingId, { transcriptReady: true }));
          }
        }
        void refreshSessions();
        return;
      }

      // 已有 file→sessionId 时直接用权威 id，避免每次冷启动都生成新的 sess_ui_*
      // 导致与扩展 View 的 sessionId 永远对不上
      const openId = existingId ?? newLocalSessionId();

      // 连续两次点击同一冷会话：桶里已有装载好的历史 → 复用同桶，不重读盘（§3.1）。
      // 能找到同桶依赖初始 setState 的 sessionFile patch 写入的 fileIndex，
      // 丢了那行这里会 newLocalSessionId 分裂出第二个桶。
      if (existing?.transcriptReady && existing.entries.length > 0) {
        setState((prev) => {
          let next = patchBucket(prev, openId, {
            sessionFile: file,
            cwd: cwd ?? prev.buckets.get(openId)?.cwd ?? null,
            switching: false,
            phase: "idle",
          });
          next = setActiveKey(next, openId);
          next = clearUnread(next, file);
          return next;
        });
        bindActive(openId);
        // 冷打开：零 spawn，但登记 Catalog context（能力入口可见）
        notifySessionRuntimeContext(openId, {
          cwd: cwd ?? existing?.cwd ?? null,
          sessionFile: file,
          processAlive: false,
        });
        void prefetchService
          .notifyActive({
            sessionId: openId,
            sessionFile: file,
            cwd: cwd ?? existing?.cwd ?? null,
            intent: "open",
          })
          .catch(() => {});
        setSwitchingToFile(null);
        navigate("session");
        void refreshModelState();
        void refreshSessions();
        return;
      }

      const switchId = (existing?.switchId ?? 0) + 1;
      openBucketByFileRef.current.set(file, { bucketId: openId, switchId });
      setSwitchingToFile(file);
      notifySessionRuntimeContext(openId, { cwd: cwd ?? null, sessionFile: file });
      setState((prev) => {
        let next = ensureBucket(prev, openId);
        // sessionFile patch 顺带写 fileIndex：懒加载后这是冷会话同桶复用的唯一依赖
        next = patchBucket(next, openId, {
          sessionFile: file,
          cwd: cwd ?? prev.buckets.get(openId)?.cwd ?? null,
          switching: true,
          switchId,
          transcriptReady: false,
          phase: "idle",
        });
        next = applyEntries(next, openId, { type: "clear" });
        next = setActiveKey(next, openId);
        next = clearUnread(next, file);
        return next;
      });
      bindActive(openId);
      navigate("session");
      // 冷打开不再 spawn：modelLabel 刷新显式补上（现状挂在 startPromise 里，§3.1），
      // 冷目标走 getModelState 的 A5 回退展示 pi 配置默认模型
      void refreshModelState();
      // docs/design/44 A1：首开冷会话即触发预热（零 spawn 展示历史，pi 在发送前就位）；
      // 上面的"二次打开"分支与热分支各自已有同款通知
      void prefetchService
        .notifyActive({
          sessionId: openId,
          sessionFile: file,
          cwd: cwd ?? null,
          intent: "open",
        })
        .catch(() => {});

      const startedAt = allSessionsRef.current.find((s) => s.file === file)?.startedAt;

      /** 注册仍是本次打开（未被更新的打开覆盖）时才允许落桶 / 收尾。 */
      const isCurrentOpen = (): boolean => {
        const reg = openBucketByFileRef.current.get(file);
        return Boolean(reg && reg.bucketId === openId && reg.switchId === switchId);
      };

      /** switchId 挂在本桶上；桶不存在则视为过期。 */
      const isStale = (): boolean => {
        const cur = bucketsStateRef.current.buckets.get(openId);
        return cur == null || cur.switchId !== switchId;
      };

      await sessionService
        .readTranscript(file)
        .then(({ messages }) => {
          if (!isCurrentOpen()) return;
          if (isStale()) return;
          // 竞态守卫（§3.3）：用户抢在落桶前发送时合并落桶，
          // 不走整体替换清掉乐观插入的用户消息
          setState((prev) => loadMessagesIntoBucket(prev, openId, messages, startedAt));
          setState((prev) =>
            patchBucket(prev, openId, { transcriptReady: true, switching: false, phase: "idle" }),
          );
        })
        .catch(() => {});

      if (isCurrentOpen()) {
        openBucketByFileRef.current.delete(file);
        const cur = bucketsStateRef.current.buckets.get(openId);
        if (!cur || cur.switchId === switchId || cur.switchId === 0) {
          setSwitchingToFile(null);
          setState((prev) => patchBucket(prev, openId, { switching: false }));
        }
        void refreshSessions();
      }
    },
    [bindActive, navigate, refreshModelState, refreshSessions, rematerializeSidebar, setState],
  );

  const getSessionFileById = useCallback(
    (sessionId: string): string | null => bucketsState.buckets.get(sessionId)?.sessionFile ?? null,
    [bucketsState.buckets],
  );

  /** JSONL 路径 → 运行时 SessionId（后台进程归属查询用）；无存活实例为 null。 */
  const getSessionIdForFile = useCallback((file: string): SessionId | null => {
    const st = bucketsStateRef.current;
    return st.fileIndex.get(file) ?? sessionIdByFileRef.current.get(file) ?? null;
  }, []);

  const metaValue = useMemo<SessionMetaValue>(
    () => ({
      phase,
      activeSessionId: bucketsState.activeKey,
      allSessions,
      activeSessionFile,
      unreadFiles: bucketsState.unreadFiles,
      unreadDoneFile,
      runningFiles,
      pinnedFiles,
      archivedFiles,
      sessionTitles,
      processAlive,
      liveSessionCount,
      switchingTo: switchingToFile,
      transcriptReady,
      startPending,
      modelLabel,
      modelInput,
      contextUsage: activeBucket?.contextUsage ?? null,
      contextBreakdown: activeBucket?.contextBreakdown ?? null,
      contextOtherPercent: activeBucket?.contextOtherPercent ?? null,
      contextWindow:
        activeBucket?.contextWindow ?? activeBucket?.contextUsage?.contextWindow ?? null,
      autoCompactionEnabled: activeBucket?.autoCompactionEnabled === true,
      piReady,
      sessionWorkingDir,
      firstUserText,
      ensureSession,
      getSlashCommands,
      newSession,
      togglePin,
      archiveSession,
      unarchiveSession,
      renameSession,
      removeSession,
      endSessionProcess,
      isFileProcessAlive: isFileProcessAliveCb,
      isFileRunning: isFileRunningCb,
      send,
      stop,
      canRetryLastUser,
      retryLastUserMessage,
      addSnapshot,
      openSessionFile,
      refreshSidebarSessions: refreshSessions,
      getSessionFileById,
      getSessionIdForFile,
      refreshModelState,
      refreshContextUsage,
    }),
    [
      phase,
      bucketsState.activeKey,
      allSessions,
      activeSessionFile,
      bucketsState.unreadFiles,
      unreadDoneFile,
      runningFiles,
      pinnedFiles,
      archivedFiles,
      sessionTitles,
      processAlive,
      liveSessionCount,
      switchingToFile,
      transcriptReady,
      startPending,
      modelLabel,
      modelInput,
      activeBucket?.contextUsage,
      activeBucket?.contextBreakdown,
      activeBucket?.contextOtherPercent,
      activeBucket?.contextWindow,
      activeBucket?.autoCompactionEnabled,
      piReady,
      sessionWorkingDir,
      firstUserText,
      ensureSession,
      getSlashCommands,
      newSession,
      togglePin,
      archiveSession,
      unarchiveSession,
      renameSession,
      removeSession,
      endSessionProcess,
      isFileProcessAliveCb,
      isFileRunningCb,
      send,
      stop,
      canRetryLastUser,
      retryLastUserMessage,
      addSnapshot,
      openSessionFile,
      getSessionFileById,
      getSessionIdForFile,
      refreshModelState,
      refreshContextUsage,
      refreshSessions,
    ],
  );

  const transcriptValue = useMemo<SessionTranscriptValue>(() => ({ entries }), [entries]);

  return (
    <SessionMetaContext.Provider value={metaValue}>
      <SessionTranscriptContext.Provider value={transcriptValue}>
        {children}
      </SessionTranscriptContext.Provider>
    </SessionMetaContext.Provider>
  );
}

/** 低频会话元数据：流式 delta 时引用稳定，不触发重渲染。 */
export function useSessionMeta(): SessionMetaValue {
  const ctx = useContext(SessionMetaContext);
  if (!ctx) throw new Error("useSessionMeta 必须在 SessionProvider 内使用");
  return ctx;
}

/** 高频会话文档流：仅需要 entries 的组件订阅。 */
export function useSessionEntries(): SessionEntry[] {
  const ctx = useContext(SessionTranscriptContext);
  if (!ctx) throw new Error("useSessionEntries 必须在 SessionProvider 内使用");
  return ctx.entries;
}
