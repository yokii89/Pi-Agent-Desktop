/**
 * 渲染层多会话桶状态（纯逻辑）：双索引 sessionId + sessionFile（决策 #5）。
 * sessionEntriesReducer 保持纯函数；本模块只做外层按 sessionId 分发。
 */
import type {
  PiChatMessage,
  PiContextBreakdownSlice,
  PiContextUsage,
  SessionId,
} from "../../shared/ipc";
import { normalizeCwdKey } from "../services/slashCommandCache";
import { type SessionEntry, sessionEntriesReducer } from "./sessionTranscript";

export type SessionPhase = "empty" | "running" | "idle";

export interface SessionBucket {
  sessionId: SessionId;
  phase: SessionPhase;
  entries: SessionEntry[];
  processAlive: boolean;
  sessionFile: string | null;
  cwd: string | null;
  transcriptReady: boolean;
  /** 仅 active 桶的切换中态；后台 start 不置 switching。 */
  switching: boolean;
  /** per-bucket 竞态 token，过期结果丢弃。 */
  switchId: number;
  /**
   * 冷启动进行中（send 触发的 spawn 未 settle）；PiColdStartBar 的驱动源。
   * 只在 send 冷路径挂载，slash 预热等 ensureSession 不参与。
   */
  startPending: boolean;
  /** 上下文用量（RPC get_session_stats）；null = 尚未拉取或不可得。 */
  contextUsage: PiContextUsage | null;
  /** 消息侧分类占比（估算相对值）。 */
  contextBreakdown: PiContextBreakdownSlice[] | null;
  /** 残差桶占比（>40 时 UI 注明含系统提示与工具定义）。 */
  contextOtherPercent: number | null;
  /** 模型上下文窗口（get_state）；stats 尚未返回时的分母兜底。 */
  contextWindow: number | null;
  /** pi 自动压缩开关（get_state）。 */
  autoCompactionEnabled: boolean;
}

export interface SessionBucketsState {
  /** 运行时权威：sessionId → 桶。 */
  buckets: Map<SessionId, SessionBucket>;
  /** sessionFile → sessionId（有 file 才写入；结束进程后删条目）。 */
  fileIndex: Map<string, SessionId>;
  /** 中央区当前桶；null = 空态（无进程的新建）。 */
  activeKey: SessionId | null;
  /** 完成未读的 JSONL 路径集合（多会话可并存多个绿点）。 */
  unreadFiles: ReadonlySet<string>;
}

export function emptyBucket(
  sessionId: SessionId,
  patch?: Partial<Omit<SessionBucket, "sessionId" | "entries">> & { entries?: SessionEntry[] },
): SessionBucket {
  return {
    sessionId,
    phase: patch?.phase ?? "empty",
    entries: patch?.entries ?? [],
    processAlive: patch?.processAlive ?? false,
    sessionFile: patch?.sessionFile ?? null,
    cwd: patch?.cwd ?? null,
    transcriptReady: patch?.transcriptReady ?? false,
    switching: patch?.switching ?? false,
    switchId: patch?.switchId ?? 0,
    startPending: patch?.startPending ?? false,
    contextUsage: patch?.contextUsage ?? null,
    contextBreakdown: patch?.contextBreakdown ?? null,
    contextOtherPercent: patch?.contextOtherPercent ?? null,
    contextWindow: patch?.contextWindow ?? null,
    autoCompactionEnabled: patch?.autoCompactionEnabled ?? false,
  };
}

export function createBucketsState(): SessionBucketsState {
  return {
    buckets: new Map(),
    fileIndex: new Map(),
    activeKey: null,
    unreadFiles: new Set(),
  };
}

/** create-on-demand：start 响应前的 push 也能落桶（B2）。 */
export function ensureBucket(
  state: SessionBucketsState,
  sessionId: SessionId,
): SessionBucketsState {
  if (state.buckets.has(sessionId)) return state;
  const buckets = new Map(state.buckets);
  buckets.set(sessionId, emptyBucket(sessionId));
  return { ...state, buckets };
}

export function patchBucket(
  state: SessionBucketsState,
  sessionId: SessionId,
  patch: Partial<Omit<SessionBucket, "sessionId" | "entries">> & { entries?: SessionEntry[] },
): SessionBucketsState {
  const next = ensureBucket(state, sessionId);
  const bucket = next.buckets.get(sessionId);
  if (!bucket) return next;
  const merged: SessionBucket = { ...bucket, ...patch, sessionId };
  const buckets = new Map(next.buckets);
  buckets.set(sessionId, merged);
  let fileIndex = next.fileIndex;
  if (patch.sessionFile !== undefined && patch.sessionFile !== null) {
    if (fileIndex.get(patch.sessionFile) !== sessionId) {
      fileIndex = new Map(next.fileIndex);
      fileIndex.set(patch.sessionFile, sessionId);
    }
  }
  return { ...next, buckets, fileIndex };
}

export function applyEntries(
  state: SessionBucketsState,
  sessionId: SessionId,
  action: Parameters<typeof sessionEntriesReducer>[1],
): SessionBucketsState {
  const next = ensureBucket(state, sessionId);
  const bucket = next.buckets.get(sessionId);
  if (!bucket) return next;
  const entries = sessionEntriesReducer(bucket.entries, action);
  return patchBucket(next, sessionId, { entries });
}

export function claimFile(
  state: SessionBucketsState,
  sessionId: SessionId,
  file: string,
): SessionBucketsState {
  const next = ensureBucket(state, sessionId);
  const buckets = new Map(next.buckets);
  const bucket = buckets.get(sessionId);
  if (!bucket) return next;
  buckets.set(sessionId, { ...bucket, sessionFile: file });
  const fileIndex = new Map(next.fileIndex);
  fileIndex.set(file, sessionId);
  return { ...next, buckets, fileIndex };
}

export function dropFileIndex(state: SessionBucketsState, file: string): SessionBucketsState {
  if (!state.fileIndex.has(file)) return state;
  const fileIndex = new Map(state.fileIndex);
  fileIndex.delete(file);
  return { ...state, fileIndex };
}

/**
 * 只登记 fileIndex，不改 bucket.sessionFile。
 * 用于 pending 占位 key：侧栏 running/点击路由要用，但 sessionFile 仍应等到真实 JSONL 再写。
 */
export function indexFileOnly(
  state: SessionBucketsState,
  sessionId: SessionId,
  file: string,
): SessionBucketsState {
  const fileIndex = new Map(state.fileIndex);
  fileIndex.set(file, sessionId);
  return { ...state, fileIndex };
}

export function setActiveKey(
  state: SessionBucketsState,
  activeKey: SessionId | null,
): SessionBucketsState {
  return { ...state, activeKey };
}

export function markUnread(state: SessionBucketsState, file: string): SessionBucketsState {
  if (state.unreadFiles.has(file)) return state;
  const unreadFiles = new Set(state.unreadFiles);
  unreadFiles.add(file);
  return { ...state, unreadFiles };
}

export function clearUnread(state: SessionBucketsState, file: string): SessionBucketsState {
  if (!state.unreadFiles.has(file)) return state;
  const unreadFiles = new Set(state.unreadFiles);
  unreadFiles.delete(file);
  return { ...state, unreadFiles };
}

/** 侧栏 running 集合：fileIndex → bucket.processAlive && phase==="running"。 */
export function deriveRunningFiles(state: SessionBucketsState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [file, id] of state.fileIndex) {
    const bucket = state.buckets.get(id);
    if (bucket?.processAlive && bucket.phase === "running") out.add(file);
  }
  return out;
}

export function isFileRunning(state: SessionBucketsState, file: string): boolean {
  const id = state.fileIndex.get(file);
  if (!id) return false;
  const bucket = state.buckets.get(id);
  return Boolean(bucket?.processAlive && bucket.phase === "running");
}

export function isFileProcessAlive(state: SessionBucketsState, file: string): boolean {
  const id = state.fileIndex.get(file);
  if (!id) return false;
  return Boolean(state.buckets.get(id)?.processAlive);
}

export function getActiveBucket(state: SessionBucketsState): SessionBucket | null {
  if (!state.activeKey) return null;
  return state.buckets.get(state.activeKey) ?? null;
}

/**
 * 清 startPending；桶已被迁移/删除时不动。
 * patchBucket 内部 ensureBucket 会把不存在的 sessionId 复活成僵尸桶，
 * 所以清理前必须先确认桶还在（docs/会话进程懒加载方案 §3.2）。
 */
export function clearStartPending(
  state: SessionBucketsState,
  sessionId: SessionId,
): SessionBucketsState {
  if (!state.buckets.get(sessionId)?.startPending) return state;
  return patchBucket(state, sessionId, { startPending: false });
}

/**
 * transcript 落桶（docs/会话进程懒加载方案 §3.3 的竞态守卫）：
 * loadMessages 是整体替换，冷打开后用户可能抢在磁盘读取完成前发送
 * （retry 等绕过 switching 锁的旁路路径），直接落桶会清掉乐观插入的用户消息。
 * 桶内已有用户消息或处于 running 时先做后缀对齐：桶内直播条目渲染的往往就是
 * pi 已持久化的同一批消息（发送 → 落盘 → 读回的竞态窗口），对齐命中时只保留
 * 磁盘里该起点之前的历史、用直播条目替代同轮次的磁盘副本，否则会拼接出
 * 重复气泡与重复轮次；对不上（读盘先于落盘）才整体拼接。
 */
export function loadMessagesIntoBucket(
  state: SessionBucketsState,
  sessionId: SessionId,
  messages: PiChatMessage[],
  sessionStartedAt?: number,
): SessionBucketsState {
  const next = ensureBucket(state, sessionId);
  const bucket = next.buckets.get(sessionId);
  if (!bucket) return next;
  const hasOptimisticTail =
    bucket.phase === "running" || bucket.entries.some((entry) => entry.kind === "user");
  if (!hasOptimisticTail) {
    return applyEntries(next, sessionId, { type: "loadMessages", messages, sessionStartedAt });
  }
  const diskEntries = sessionEntriesReducer([], {
    type: "loadMessages",
    messages,
    sessionStartedAt,
  });
  const alignedAt = alignTailInDisk(diskEntries, bucket.entries);
  if (alignedAt === null) {
    // 读盘先于落盘：磁盘没有这些轮次，拼接保留乐观尾部
    return patchBucket(next, sessionId, { entries: [...diskEntries, ...bucket.entries] });
  }
  const tailStart = bucket.entries.findIndex((entry) => entry.kind === "user");
  const head = tailStart > 0 ? bucket.entries.slice(0, tailStart) : [];
  const tailHasRendering = bucket.entries.some(
    (entry) => entry.kind === "run" || entry.kind === "assistant",
  );
  if (!tailHasRendering) {
    // 尾部只有乐观气泡（直播还没开始渲染该轮）：磁盘已完整覆盖，整体替换防丢已落盘回复
    return patchBucket(next, sessionId, { entries: [...head, ...diskEntries] });
  }
  // 直播渲染该轮中/已收口：直播条目为准，只保留磁盘里该起点之前的历史
  return patchBucket(next, sessionId, {
    entries: [...diskEntries.slice(0, alignedAt), ...bucket.entries],
  });
}

/**
 * 在磁盘重建条目中定位桶内直播条目的起点：桶内用户消息文本序列若是磁盘用户
 * 消息文本序列的后缀，返回该后缀在磁盘侧的起始条目下标；对不上返回 null。
 * 直播气泡存 trim 后的裸文本，磁盘侧可能带浏览器上下文包裹，包含即视为同一条。
 */
function alignTailInDisk(diskEntries: SessionEntry[], tailEntries: SessionEntry[]): number | null {
  const diskUsers = diskEntries.flatMap((entry, index) =>
    entry.kind === "user" ? [{ index, text: entry.text }] : [],
  );
  const tailTexts = tailEntries.flatMap((entry) => (entry.kind === "user" ? [entry.text] : []));
  if (tailTexts.length === 0 || tailTexts.length > diskUsers.length) return null;
  for (let start = diskUsers.length - tailTexts.length; start >= 0; start -= 1) {
    let matched = true;
    for (let k = 0; k < tailTexts.length; k += 1) {
      if (!sameUserTurn(diskUsers[start + k].text, tailTexts[k])) {
        matched = false;
        break;
      }
    }
    if (matched) return diskUsers[start].index;
  }
  return null;
}

function sameUserTurn(diskText: string, tailText: string): boolean {
  if (diskText === tailText) return true;
  return tailText.length > 0 && diskText.includes(tailText);
}

/**
 * 同 cwd 命令借用（docs/会话进程懒加载方案 §5.2）：
 * get_commands 由 pi 配置 + cwd 扩展决定，与会话内容无关，
 * 冷桶可借用同 cwd 任意存活实例拉取，不为看斜杠菜单 spawn。
 * cwd 比较走归一化 key（Windows 盘符大小写 / 分隔符差异）。
 */
export function findCommandBorrowSessionId(
  state: SessionBucketsState,
  cwd: string | null | undefined,
): SessionId | null {
  const key = normalizeCwdKey(cwd);
  if (!key) return null;
  for (const bucket of state.buckets.values()) {
    if (!bucket.processAlive) continue;
    if (normalizeCwdKey(bucket.cwd) === key) return bucket.sessionId;
  }
  return null;
}
