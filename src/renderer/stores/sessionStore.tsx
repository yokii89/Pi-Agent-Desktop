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
  PiAgentEvent,
  PiContextBreakdownSlice,
  PiContextUsage,
  PiImageContent,
  PiModelInputModality,
  PiQueuedMessages,
  PiSlashCommand,
  PromptDisposition,
  QueueIntent,
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
import { getComposerThinkingLevel, useComposerStore } from "./composerStore";
import { isModeTransitioning } from "./modeTransitionBarrier";
import { useProjectStore } from "./projectStore";
import {
  applyEntries,
  claimFile,
  clearStartPending,
  clearUnread,
  createBucketsState,
  deliveredQueueTexts,
  deriveRunningFiles,
  dropFileIndex,
  editQueueItem,
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
  sameQueue,
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
  /** 在工作区内置顶的会话文件（数组顺序即置顶顺序）；条目固定在其所属列表最前。 */
  pinnedFiles: string[];
  /** 全局置顶的会话文件（数组顺序即置顶顺序）；从原分组提出，固定展示在侧栏「置顶」分区（docs/design/45）。 */
  globalPinnedFiles: string[];
  /** 已归档的会话（JSONL 绝对路径 → 归档时间 Unix ms）；侧栏主列表不展示，管理入口在设置页（docs/design/32）。 */
  archivedFiles: Record<string, number>;
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
  /** 全局置顶开关（docs/design/45）：置顶条目从原分组提出，进入侧栏顶部「置顶」分区。 */
  toggleGlobalPin: (file: string) => void;
  /** 手动标记会话未读（行菜单）；已浏览会话由既有的清除副作用消化。 */
  markSessionUnread: (file: string) => void;
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
  /**
   * 提交用户输入。返回 pi 的受理结果；失败/被门禁拦下返回 null。
   * 运行中默认作为「稍后」排队；`/steer <内容>` 由输入栏解析为「插话」。
   */
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
    intent?: QueueIntent,
  ) => Promise<PromptDisposition | null>;
  /** 停止：队列非空时先取回文本（回填输入框），再 abort active 实例。 */
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
  /** 拉取上下文用量（get_session_stats）；agent_settled / compaction_end / 手动点击触发，不轮询。 */
  refreshContextUsage: (sessionId?: SessionId) => Promise<void>;
}

/** 高频会话文档流：仅 SessionView / 相关条目组件订阅（active 桶）。 */
interface SessionTranscriptValue {
  entries: SessionEntry[];
}

/**
 * 会话队列：只在快照真正变化时换引用。
 * 队列动作是用户触发的突发（撤销 / 编辑会连清带排产生一串 queue_update），
 * 放进低频 meta 会让每个 meta 消费方跟着重渲染，单开一条 context 只唤 QueueTail。
 */
interface SessionQueueValue {
  /** active 桶的 pi 队列快照（插话 / 稍后）。 */
  queue: PiQueuedMessages;
  /**
   * 单条撤销：全清后取回该条文本到输入框，其余按原序重新排队。
   * `source` 是发起时该条原文，用于队列已变化时放弃；失败/放弃自行 toast。
   */
  withdrawQueuedItem: (kind: QueueIntent, index: number, source: string) => Promise<boolean>;
  /**
   * 单条编辑：全清后原位置替换该条文本（队列顺序不变），其余按原序重新排队。
   * `source` 是发起时该条原文，`text` 是新文本；失败/放弃自行 toast。
   */
  editQueuedItem: (
    kind: QueueIntent,
    index: number,
    source: string,
    text: string,
  ) => Promise<boolean>;
}

/** 无队列时的稳定空快照（避免队列 context 每次渲染换引用）。 */
const EMPTY_QUEUE: PiQueuedMessages = { steering: [], followUp: [] };

const SessionMetaContext = createContext<SessionMetaValue | null>(null);
const SessionTranscriptContext = createContext<SessionTranscriptValue | null>(null);
const SessionQueueContext = createContext<SessionQueueValue | null>(null);

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

/** 待用新会话 id（docs/design/44 A2）：带 cwd 绑定，跨项目即作废。 */
type PendingNewChatRef = { current: { cwd: string | null; id: SessionId } | null };

/** 消费待用新会话 id：cwd 不匹配则丢弃（预热实例由主进程 hint 清理）。 */
function takePendingNewChat(ref: PendingNewChatRef, cwd: string | null): SessionId | null {
  const pending = ref.current;
  ref.current = null;
  return pending && pending.cwd === cwd ? pending.id : null;
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
  pendingNames?: ReadonlyMap<string, string | null>,
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
      sessionName: pendingNames?.get(file) ?? null,
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
  /** 停止 / 清空队列后把取回的文本交回输入栏（TaskInput 消费并写入编辑器）。 */
  const { appendToComposer } = useComposerStore();
  const [bucketsState, dispatchBuckets] = useReducer(bucketsReducer, undefined, createBucketsState);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [globalPinnedFiles, setGlobalPinnedFiles] = useState<string[]>([]);
  const [archivedFiles, setArchivedFiles] = useState<Record<string, number>>({});
  const [modelLabel, setModelLabel] = useState("pi");
  const [modelInput, setModelInput] = useState<PiModelInputModality[] | null>(null);
  const [piReady, setPiReady] = useState(false);
  const [switchingToFile, setSwitchingToFile] = useState<string | null>(null);

  const bucketsStateRef = useRef(bucketsState);
  bucketsStateRef.current = bucketsState;
  const pageRef = useRef<PageId>("session");
  pageRef.current = page;
  const allSessionsRef = useRef<SessionSummary[]>([]);
  /** 未落盘会话的名字（pending key → name）；认领真实文件后随 pi JSONL 走。 */
  const pendingNamesRef = useRef<Map<string, string | null>>(new Map());
  const cwdRef = useRef<string | undefined>(undefined);
  cwdRef.current = currentProject?.dir;
  /** 高频动作只读 ref，避免 useCallback 依赖桶 state 导致闭包过期。 */
  const activeKeyRef = useRef<SessionId | null>(null);
  activeKeyRef.current = bucketsState.activeKey;
  /** 待用新会话 id（docs/design/44 A2）：点击"新建会话"即对它预热，发送时消费。 */
  const pendingNewChatRef = useRef<{ cwd: string | null; id: SessionId } | null>(null);
  /** 在途的单条撤销/编辑：stop 等它落定再 abort，避免重排的消息在停止后开新一轮。 */
  const queueEditInFlightRef = useRef<Promise<boolean> | null>(null);

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

  /**
   * 生成中的文件集合只随 agent_start / agent_settled 这类阶段边界变化，
   * 但流式 delta 每帧都会改 bucketsState。保留内容相同的旧集合，
   * meta context 才不会每帧换身份、把整个侧栏列表拖进重渲染。
   */
  const runningFilesRef = useRef<ReadonlySet<string>>(new Set());
  const runningFiles = useMemo(() => {
    const next = deriveRunningFiles(bucketsState);
    const prev = runningFilesRef.current;
    if (next.size === prev.size && [...next].every((file) => prev.has(file))) return prev;
    runningFilesRef.current = next;
    return next;
  }, [bucketsState]);

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
    const merged = mergeSessionLists(
      disk,
      bucketsStateRef.current.buckets,
      pendingNamesRef.current,
    );
    setAllSessions(merged);
    return disk;
  }, []);

  /**
   * 单个会话改名：真实文件同时改磁盘快照（否则下一次 rematerialize 会把名字冲掉）；
   * pending 行记在 map 里，认领 JSONL 后以磁盘为准。
   */
  const applySessionName = useCallback((file: string, name: string | null): void => {
    if (isPendingFile(file)) pendingNamesRef.current.set(file, name);
    const patch = (list: SessionSummary[]): SessionSummary[] =>
      list.map((session) => (session.file === file ? { ...session, sessionName: name } : session));
    setAllSessions((prev) => patch(prev));
    allSessionsRef.current = patch(allSessionsRef.current);
    if (!isPendingFile(file)) {
      diskSessionsRef.current = patch(diskSessionsRef.current);
    }
  }, []);

  /** 桶状态变化后重算侧栏（不发起 listAll）。 */
  const rematerializeSidebar = useCallback((): void => {
    setAllSessions(
      mergeSessionLists(
        diskSessionsRef.current,
        bucketsStateRef.current.buckets,
        pendingNamesRef.current,
      ),
    );
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
        sessionName: pendingNamesRef.current.get(file) ?? null,
        cwd,
      };
      setAllSessions((prev) => [summary, ...prev.filter((s) => s.file !== file)]);
    },
    [],
  );

  /** 回收预插的 pending 行（start 失败时），避免孤儿占位；下次 merge 本也会自然清掉。 */
  const dropPendingSummary = useCallback((sessionId: SessionId): void => {
    const file = pendingFileKey(sessionId);
    pendingNamesRef.current.delete(file);
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
          const pendingKey = pendingFileKey(sessionId);
          const pendingName = pendingNamesRef.current.get(pendingKey) ?? null;
          const diskMatch = sessions.find((s) => s.file === claimed);
          pendingNamesRef.current.delete(pendingKey);
          const optimistic: SessionSummary = {
            file: claimed,
            id: sessionId,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            firstUserMessage: firstUserTextOf(bucket?.entries ?? []),
            sessionName: diskMatch?.sessionName ?? pendingName,
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

  /** 发送后立刻在侧栏出现，并轮询认领 JSONL（不等整轮收口）。 */
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

  /** 上下文用量：只在 agent_settled / compaction_end / set_model / 手动点击时拉取，不挂 message_update。 */
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
        if (id !== bucketId) {
          // 临时桶换成权威 id 时，pending 行上的名字跟着换 key，别留在旧 id 下
          const from = pendingFileKey(bucketId);
          const to = pendingFileKey(id);
          if (pendingNamesRef.current.has(from)) {
            if (!pendingNamesRef.current.has(to)) {
              pendingNamesRef.current.set(to, pendingNamesRef.current.get(from) ?? null);
            }
            pendingNamesRef.current.delete(from);
          }
        }
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

    const applySideEffects = (sessionId: SessionId, event: PiAgentEvent): void => {
      const { type } = event;
      setState((prev) => {
        let next = ensureBucket(prev, sessionId);
        const bucket = next.buckets.get(sessionId);
        if (type === "agent_start") {
          next = patchBucket(next, sessionId, { phase: "running" });
          return next;
        }
        if (type === "agent_settled") {
          // agent_end 不再置 idle：自动重试／压缩恢复／before_settle 续跑都接在它后面，
          // 只有 settled 表示本轮真的收口（docs/design/76 §6.2）
          next = patchBucket(next, sessionId, { phase: "idle" });
          return next;
        }
        if (bucket) return prev;
        return next;
      });
      if (type === "agent_start") {
        void claimSessionFile(sessionId);
        scheduleClaim(sessionId);
      } else if (type === "agent_settled") {
        // 认领 JSONL、侧栏重排、未读、上下文用量都跟着收口点走
        const aborted = event.aborted === true;
        void claimSessionFile(sessionId).then((file) => {
          rematerializeSidebar();
          if (!file) return;
          // 用户主动中断的一轮不算「有新结果待读」，不标未读
          if (aborted) return;
          const st = bucketsStateRef.current;
          const isActive = st.activeKey === sessionId && pageRef.current === "session";
          if (!isActive) {
            setState((prev) => markUnread(prev, file));
          }
        });
        void refreshContextUsage(sessionId);
      } else if (type === "compaction_end") {
        // 压缩后 percent 可能为 null（pi 契约），chip 显示 `?`；下一次 settled 恢复数字
        void refreshContextUsage(sessionId);
      }
    };

    return sessionService.subscribe((message) => {
      const sessionId = message.sessionId;

      // pi 侧改名（/name、扩展、本应用 rename 的 RPC 回执）：标题只存 session_info
      if (message.type === "event" && message.payload.type === "session_info_changed") {
        const raw = message.payload.name;
        const name = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
        const bucket = bucketsStateRef.current.buckets.get(sessionId);
        if (!bucket) {
          void refreshSessions();
          return;
        }
        // 尚未认领 JSONL 的会话用 pending key：改名要立刻反映到侧栏，不能等磁盘列表
        const file = bucket.sessionFile ?? pendingFileKey(sessionId);
        const known = allSessionsRef.current.some((s) => s.file === file);
        applySessionName(file, name);
        if (!known) void refreshSessions();
        return;
      }

      // 队列变化：queue_update 是全量快照；收缩 = 交付（主动 clear_queue 时除外）
      if (message.type === "event" && message.payload.type === "queue_update") {
        const { steering, followUp } = message.payload;
        setState((prev) => {
          const bucket = prev.buckets.get(sessionId);
          if (!bucket) return prev;
          const nextQueue = { steering, followUp };
          // 同一快照重复推送：不动 state，也就不触发一次全量渲染
          if (sameQueue(bucket.queue, nextQueue)) return prev;
          let next = prev;
          if (!bucket.queueClearing) {
            // 交付的排队消息落成普通用户气泡；文本取服务端（与写进 JSONL 的展开文本一致）
            for (const text of deliveredQueueTexts(bucket.queue, nextQueue)) {
              next = applyEntries(next, sessionId, { type: "userMessage", text });
            }
          }
          return patchBucket(next, sessionId, { queue: nextQueue });
        });
        return;
      }

      if (message.type === "event") {
        applySideEffects(sessionId, message.payload);
        setState((prev) =>
          applyEntries(prev, sessionId, { type: "event", event: message.payload }),
        );
        return;
      }
      if (message.type === "eventBatch") {
        for (const event of message.payload) {
          applySideEffects(sessionId, event);
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
            // 进程退出后队列不会再交付
            queue: { steering: [], followUp: [] },
            queueClearing: false,
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
    applySessionName,
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
      setGlobalPinnedFiles(settings.globalPinnedSessions);
      setArchivedFiles(settings.archivedSessions);
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
      const newId =
        takePendingNewChat(pendingNewChatRef, cwdRef.current ?? null) ?? newLocalSessionId();
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
    // docs/design/44 A2：生成/复用待用 id 并立即预热（无 sessionFile = 待用新会话）；
    // 不建桶、不切 active，UX 与现状一致，发送时消费该实例。
    const cwd = cwdRef.current ?? null;
    const existing = pendingNewChatRef.current;
    const id = existing && existing.cwd === cwd ? existing.id : newLocalSessionId();
    pendingNewChatRef.current = { cwd, id };
    void prefetchService
      .notifyActive({ sessionId: id, sessionFile: null, cwd, intent: "open" })
      .catch(() => {});
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

  const commitGlobalPinned = useCallback((next: string[]): void => {
    setGlobalPinnedFiles(next);
    void settingsService.set({ globalPinnedSessions: next });
  }, []);

  /** 全局置顶（docs/design/45）：从原分组提出，固定展示在侧栏顶部「置顶」分区。 */
  const toggleGlobalPin = useCallback(
    (file: string): void => {
      commitGlobalPinned(
        globalPinnedFiles.includes(file)
          ? globalPinnedFiles.filter((f) => f !== file)
          : [...globalPinnedFiles, file],
      );
    },
    [globalPinnedFiles, commitGlobalPinned],
  );

  /** 手动标记未读（侧栏行菜单）；当前正在浏览的会话由清除副作用立即消化。 */
  const markSessionUnread = useCallback(
    (file: string): void => {
      setState((prev) => markUnread(prev, file));
    },
    [setState],
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
      if (globalPinnedFiles.includes(file)) {
        commitGlobalPinned(globalPinnedFiles.filter((f) => f !== file));
      }
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
      commitGlobalPinned,
      commitPinned,
      globalPinnedFiles,
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

  /**
   * 重命名：唯一存储是 pi JSONL 的 session_info。
   * 未落盘的新会话带着运行时 id，由主进程走 RPC；空名 = 清除。
   */
  const renameSession = useCallback(
    (file: string, title: string): void => {
      const trimmed = title.trim();
      const sessionId =
        bucketsStateRef.current.fileIndex.get(file) ??
        sessionIdByFileRef.current.get(file) ??
        sessionIdFromPendingFile(file);
      const previous =
        allSessionsRef.current.find((session) => session.file === file)?.sessionName ?? null;
      const optimistic = trimmed || null;
      applySessionName(file, optimistic);
      void sessionService
        .rename({ file, name: trimmed, ...(sessionId ? { sessionId } : {}) })
        .then((name) => {
          applySessionName(file, name);
          void refreshSessions();
        })
        .catch((err) => {
          console.warn("[session] 重命名失败", err);
          // 回滚乐观值：pending 行没有磁盘列表可刷新，留着错名字会一直显示
          applySessionName(file, previous);
          if (isPendingFile(file) && previous === null) pendingNamesRef.current.delete(file);
          showToast(t("sidenav.session.renameFailed"));
          void refreshSessions();
        });
    },
    [applySessionName, refreshSessions, showToast],
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
        pendingNamesRef.current.delete(file);
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
      if (globalPinnedFiles.includes(file)) {
        commitGlobalPinned(globalPinnedFiles.filter((f) => f !== file));
      }
      if (archivedFiles[file] !== undefined) {
        const nextArchived = { ...archivedFiles };
        delete nextArchived[file];
        commitArchived(nextArchived);
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
      commitGlobalPinned,
      commitPinned,
      globalPinnedFiles,
      pinnedFiles,
      refreshSessions,
      rematerializeSidebar,
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
      intent: QueueIntent = "followUp",
    ): Promise<PromptDisposition | null> => {
      const trimmed = text.trim();
      const items = context?.items ?? [];
      const images = context?.images ?? [];
      const displayImages = context?.displayImages ?? [];
      if (!trimmed && items.length === 0 && images.length === 0) return null;

      let targetId = activeKeyRef.current;
      if (isModeTransitioning(targetId)) return null;
      if (!targetId) {
        // docs/design/44 A2：优先消费"新建会话"预热的待用 id（命中则主进程直接复用实例）
        targetId =
          takePendingNewChat(pendingNewChatRef, cwdRef.current ?? null) ?? newLocalSessionId();
        setState((prev) =>
          patchBucket(prev, targetId as SessionId, {
            phase: "empty",
            cwd: cwdRef.current,
          }),
        );
      }
      const bucket = bucketsStateRef.current.buckets.get(targetId) ?? null;
      /**
       * 运行中发送：不插乐观用户气泡（排队气泡由 queue_update 产生），
       * 由 streamingBehavior 交 pi 自己判断「开新一轮」还是「排队」，避免 agent_end 竞态。
       */
      const queueing = bucket?.processAlive === true && bucket.phase === "running";
      // 同步乐观行（发送瞬间上侧栏，不等 setState 提交）：无 file 桶的 start 恒返回
      // bucketId（无 file 不可能 reuse），先于 start 插入才不会被主进程 start 内的
      // 模型对齐 RPC 拖延；已有真实 JSONL 的会话磁盘行已覆盖，不插 pending。
      // 排队不参与：侧栏标题已由首条消息决定。
      if (!queueing && !bucket?.sessionFile) {
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
          return null;
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
      if (!queueing) {
        setState((prev) => {
          let next = applyEntries(prev, targetId as SessionId, {
            type: "userMessage",
            text: trimmed,
            items,
            images: displayImages.length > 0 ? displayImages : undefined,
            optimistic: true,
          });
          next = patchBucket(next, targetId as SessionId, { phase: "running" });
          // 未落盘：只登记 fileIndex 供 running/点击，sessionFile 仍留给真实 JSONL
          const b = next.buckets.get(targetId as SessionId);
          if (b && !b.sessionFile) {
            next = indexFileOnly(
              next,
              targetId as SessionId,
              pendingFileKey(targetId as SessionId),
            );
          }
          return next;
        });
      }
      scheduleClaim(targetId);
      const sid = targetId as SessionId;
      try {
        sessionService.bindActiveSession(targetId);
        const disposition = await sessionService.prompt(
          promptText,
          targetId,
          images.length > 0 ? images : undefined,
          intent,
        );
        setState((prev) => {
          if (!prev.buckets.has(sid)) return prev;
          if (disposition === "queued" && !queueing) {
            // 本地以为空闲、pi 实际在流式：撤掉乐观气泡，排队项由 queue_update 接管
            return applyEntries(prev, sid, { type: "discardOptimisticUser" });
          }
          if (disposition === "started" && queueing) {
            // 本地以为在跑、pi 实际已结束：补插用户气泡（response 先于 agent_start）
            let next = applyEntries(prev, sid, {
              type: "userMessage",
              text: trimmed,
              items,
              images: displayImages.length > 0 ? displayImages : undefined,
            });
            next = patchBucket(next, sid, { phase: "running" });
            const still = next.buckets.get(sid);
            if (still && !still.sessionFile) {
              next = indexFileOnly(next, sid, pendingFileKey(sid));
            }
            return next;
          }
          if (disposition === "handled" && !queueing) {
            // 扩展命令 / 输入处理器消费了输入，不产生用户消息
            return applyEntries(prev, sid, { type: "discardOptimisticUser" });
          }
          return prev;
        });
        return disposition;
      } catch (err) {
        const message = err instanceof Error ? err.message : "发送失败";
        showToast(message);
        // 运行中失败：不动编辑器（TaskInput 据此保留草稿），也不把仍在跑的 run 置 idle
        if (!queueing) {
          setState((prev) => {
            if (!prev.buckets.has(sid)) return prev;
            let next = applyEntries(prev, sid, {
              type: "processError",
              message,
              title: "发送失败",
            });
            next = patchBucket(next, sid, { phase: "idle" });
            return next;
          });
        }
        return null;
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

  /**
   * 清空 pi 队列并取回文本（RPC clear_queue）。
   * 队列为空或失败返回 null；失败会自行 toast，调用方不必重复提示。
   */
  const clearQueue = useCallback(
    async (targetId?: SessionId): Promise<PiQueuedMessages | null> => {
      const id = targetId ?? activeKeyRef.current;
      if (!id) return null;
      const bucket = bucketsStateRef.current.buckets.get(id);
      if (!bucket) return null;
      if (bucket.queue.steering.length + bucket.queue.followUp.length === 0) return null;
      /** 清空瞬间的快照：响应回来时用它判断 queue_update 是否已处理。 */
      const snapshot = bucket.queue;
      setState((prev) =>
        prev.buckets.has(id) ? patchBucket(prev, id, { queueClearing: true }) : prev,
      );
      try {
        const result = await sessionService.clearQueue(id);
        setState((prev) => {
          if (!prev.buckets.has(id)) return prev;
          const current = prev.buckets.get(id);
          // queue_update 尚未处理（快照没换过）：直接置空，防止迟到的空快照
          // 在 queueClearing 复位后被当成"交付"补出用户气泡；
          // 已处理/有新排队时只复位标志，交给全量快照
          const unchanged = current?.queue === snapshot;
          return patchBucket(prev, id, {
            ...(unchanged ? { queue: { steering: [], followUp: [] } } : {}),
            queueClearing: false,
          });
        });
        return result;
      } catch (err) {
        setState((prev) =>
          prev.buckets.has(id) ? patchBucket(prev, id, { queueClearing: false }) : prev,
        );
        showToast(err instanceof Error ? err.message : t("session.queue.clearFailed"));
        return null;
      }
    },
    [setState, showToast],
  );

  const stop = useCallback((): void => {
    const id = activeKeyRef.current;
    if (!id) return;
    const bucket = bucketsStateRef.current.buckets.get(id);
    const hasQueued = Boolean(
      bucket && bucket.queue.steering.length + bucket.queue.followUp.length > 0,
    );
    setState((prev) => applyEntries(prev, id, { type: "userStop" }));
    if (!hasQueued && !queueEditInFlightRef.current) {
      sessionService.stop(id);
      return;
    }
    // pi 的 abort 不清队列：先取回排队文本（回填输入框），再中止，避免停止后继续跑。
    // 单条编辑在途时等它落定：编辑会把队列重新排入，先 abort 会让重排的消息在停止后开新一轮。
    void (async () => {
      if (queueEditInFlightRef.current) await queueEditInFlightRef.current;
      const still = bucketsStateRef.current.buckets.get(id);
      if (still && still.queue.steering.length + still.queue.followUp.length > 0) {
        const cleared = await clearQueue(id);
        if (cleared) {
          const texts = [...cleared.steering, ...cleared.followUp];
          if (texts.length > 0) appendToComposer(texts.join("\n\n"));
        } else {
          const again = bucketsStateRef.current.buckets.get(id);
          if (again && again.queue.steering.length + again.queue.followUp.length > 0) {
            showToast(t("session.queue.stopClearFailed"));
          }
        }
      }
      sessionService.stop(id);
    })();
  }, [appendToComposer, clearQueue, setState, showToast]);

  /**
   * 单条撤销 / 编辑的共同路径（docs/design/73）：pi 只有全量 clear_queue，
   * 单条动作 = 清空全部 → 客户端重排（`replacement` null 移除 / 字符串替换）→
   * 按 steering → followUp 顺序逐条重新 `prompt(streamingBehavior)`（与快照展示顺序一致）。
   * 重新排队期间保持 queueClearing：清空的迟到空快照不会被当成交付；
   * 入队事件先于 prompt 响应写出（pi 单线程 stdout），循环结束时快照已全部就位。
   */
  const applyQueueItemAction = useCallback(
    async (
      kind: QueueIntent,
      index: number,
      source: string,
      replacement: string | null,
    ): Promise<boolean> => {
      const id = activeKeyRef.current;
      if (!id) return false;
      const bucket = bucketsStateRef.current.buckets.get(id);
      if (!bucket) return false;
      const list = kind === "steer" ? bucket.queue.steering : bucket.queue.followUp;
      if (index < 0 || index >= list.length || list[index] !== source) {
        // 渲染到点击之间队列变了：位置量已经指不准，宁可不做也不改错条目
        showToast(t("session.queue.stale"));
        return false;
      }

      const cleared = await clearQueue(id);
      if (!cleared) return false;
      const edited = editQueueItem(cleared, kind, index, source, replacement);
      if (!edited) {
        // 清空往返期间该条已交付、下标指到了别人：整队文本回填输入框，一条都不能丢
        const texts = [...cleared.steering, ...cleared.followUp];
        if (texts.length > 0) appendToComposer(texts.join("\n\n"));
        showToast(t("session.queue.stale"));
        return false;
      }
      const toQueue: Array<{ kind: QueueIntent; text: string }> = [
        ...edited.steering.map((text) => ({ kind: "steer" as const, text })),
        ...edited.followUp.map((text) => ({ kind: "followUp" as const, text })),
      ];

      setState((prev) =>
        prev.buckets.has(id) ? patchBucket(prev, id, { queueClearing: true }) : prev,
      );
      try {
        let failedAt = -1;
        for (let i = 0; i < toQueue.length; i += 1) {
          const item = toQueue[i];
          try {
            await sessionService.prompt(item.text, id, undefined, item.kind);
          } catch {
            failedAt = i;
            break;
          }
        }
        if (failedAt >= 0) {
          // 部分失败：尚未排回的文本回填输入框，已排回的留在 pi 队列
          const rest = toQueue.slice(failedAt).map((item) => item.text);
          if (rest.length > 0) appendToComposer(rest.join("\n\n"));
          showToast(t("session.queue.editFailed"));
          return false;
        }
        if (replacement === null) {
          appendToComposer(edited.removed);
          showToast(t("session.queue.withdrawn"));
        } else {
          showToast(t("session.queue.editSaved"));
        }
        return true;
      } finally {
        setState((prev) =>
          prev.buckets.has(id) ? patchBucket(prev, id, { queueClearing: false }) : prev,
        );
      }
    },
    [appendToComposer, clearQueue, setState, showToast],
  );

  /** 单条撤销：同一会话内同一时刻只允许一个单条动作（UI 侧另有 busy 拦截）。 */
  const withdrawQueuedItem = useCallback(
    (kind: QueueIntent, index: number, source: string): Promise<boolean> => {
      if (queueEditInFlightRef.current) return Promise.resolve(false);
      const task = applyQueueItemAction(kind, index, source, null);
      queueEditInFlightRef.current = task;
      void task.finally(() => {
        queueEditInFlightRef.current = null;
      });
      return task;
    },
    [applyQueueItemAction],
  );

  const editQueuedItem = useCallback(
    (kind: QueueIntent, index: number, source: string, text: string): Promise<boolean> => {
      const next = text.trim();
      // 空文本没有语义（排队气泡不能是空的），原样保留该条
      if (!next || next === source || queueEditInFlightRef.current) return Promise.resolve(false);
      const task = applyQueueItemAction(kind, index, source, next);
      queueEditInFlightRef.current = task;
      void task.finally(() => {
        queueEditInFlightRef.current = null;
      });
      return task;
    },
    [applyQueueItemAction],
  );

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

  // 最新用户消息走 ref：entries 每帧变化会让闭包里的对象换身份，
  // 若作为 useCallback 依赖，meta context 就会跟着流式 delta 每帧重算。
  const lastUserPayloadRef = useRef(lastUserPayload);
  lastUserPayloadRef.current = lastUserPayload;

  const retryLastUserMessage = useCallback(async (): Promise<void> => {
    const payload = lastUserPayloadRef.current;
    if (!payload || phase === "running") return;
    const displayImages = payload.images ?? [];
    const images = displayImages.map(piImageFromDisplay);
    await send(payload.text, {
      ...(images.length > 0 ? { images, displayImages } : {}),
    });
  }, [phase, send]);

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
      // 用户转向历史会话：待用新会话 id 作废（预热实例由主进程随 hint 变化清理，A3）
      pendingNewChatRef.current = null;
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

  // 读 ref 而非 bucketsState：buckets 每帧都是新 Map，作为依赖会让 meta context
  // 跟着流式 delta 每帧重算（消费方只在调用时取最新值，不需要渲染期快照）。
  const getSessionFileById = useCallback(
    (sessionId: string): string | null =>
      bucketsStateRef.current.buckets.get(sessionId)?.sessionFile ?? null,
    [],
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
      globalPinnedFiles,
      archivedFiles,
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
      toggleGlobalPin,
      markSessionUnread,
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
      globalPinnedFiles,
      archivedFiles,
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
      toggleGlobalPin,
      markSessionUnread,
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
  const queueValue = useMemo<SessionQueueValue>(
    () => ({
      queue: activeBucket?.queue ?? EMPTY_QUEUE,
      withdrawQueuedItem,
      editQueuedItem,
    }),
    [activeBucket?.queue, withdrawQueuedItem, editQueuedItem],
  );

  return (
    <SessionMetaContext.Provider value={metaValue}>
      <SessionTranscriptContext.Provider value={transcriptValue}>
        <SessionQueueContext.Provider value={queueValue}>{children}</SessionQueueContext.Provider>
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

/** 队列快照与单条动作：只在快照变化时换引用（流式 delta 不触发）。 */
export function useSessionQueue(): SessionQueueValue {
  const ctx = useContext(SessionQueueContext);
  if (!ctx) throw new Error("useSessionQueue 必须在 SessionProvider 内使用");
  return ctx;
}
